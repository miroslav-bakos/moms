const express = require('express');
const { config } = require('../config');
const { query } = require('../db');
const { randomToken, sha256Base64Url } = require('../utils/cryptoBox');
const { setToken } = require('../services/tokenStore');
const { apiKeyHeader } = require('../channels/etsy');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

async function storeOAuthState(channel, state, values, req) {
  await query(
    `INSERT INTO oauth_states (state, channel, code_verifier, redirect_after, expires_at, owner_hash, session_hash)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes', $5, $6)`,
    [state, channel, values.codeVerifier || null, values.redirectAfter || '/', require('../services/authSessions').owner(), require('../services/authSessions').hash(req.authSession)]
  );
}

async function consumeOAuthState(channel, state) {
  const result = await query(
    `DELETE FROM oauth_states
     WHERE state = $1 AND channel = $2 AND expires_at > now() AND owner_hash = $3
       AND EXISTS (SELECT 1 FROM mobile_devices d WHERE d.token_hash=oauth_states.session_hash AND d.owner_hash=oauth_states.owner_hash AND d.expires_at>now())
     RETURNING *`,
    [state, channel, require('../services/authSessions').owner()]
  );
  return result.rows[0] || null;
}

function assertAmazonAuthConfigured() {
  if (config.amazon.authMode !== 'public') {
    const error = new Error('This Amazon app is configured for private self-authorization. Generate a refresh token in Seller Central/Solution Provider Portal and set AMAZON_REFRESH_TOKEN instead of using browser OAuth.');
    error.statusCode = 400;
    throw error;
  }
  if (!config.amazon.applicationId) {
    const error = new Error('AMAZON_APPLICATION_ID is required. Use the SP-API application id that looks like amzn1.sellerapps.app..., not the LWA client id.');
    error.statusCode = 400;
    throw error;
  }
  if (!config.amazon.lwaClientId || !config.amazon.lwaClientSecret) {
    const error = new Error('AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET are required.');
    error.statusCode = 400;
    throw error;
  }
}

function validateAmazonCallbackUri(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch (error) {
    throw new Error('Amazon login request did not include a valid amazon_callback_uri.');
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !url.pathname.startsWith('/apps/authorize/confirm/')) {
    throw new Error('Amazon callback URI is not an authorize/confirm HTTPS URL.');
  }

  if (!['amazon.com','sellercentral-europe.amazon.com','sellercentral.amazon.com','sellercentral.amazon.co.uk','sellercentral.amazon.de','sellercentral.amazon.fr','sellercentral.amazon.it','sellercentral.amazon.es','sellercentral.amazon.nl','sellercentral.amazon.se','sellercentral.amazon.pl','sellercentral.amazon.com.be','sellercentral.amazon.ie','sellercentral.amazon.co.jp','sellercentral.amazon.com.au','sellercentral.amazon.sg','sellercentral.amazon.ca','sellercentral.amazon.com.mx','sellercentral.amazon.com.br','sellercentral.amazon.in','sellercentral.amazon.ae','sellercentral.amazon.sa','sellercentral.amazon.com.tr','sellercentral.amazon.eg'].includes(host) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Amazon callback URI host was not recognized.');
  }

  return url;
}

router.get('/etsy/start', require('../middleware/basicAuth').basicAuth, require('../middleware/sameOrigin').sameOrigin, async (req, res, next) => {
  try {
    if (!config.etsy.clientId) throw new Error('ETSY_CLIENT_ID is required.');
    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const codeChallenge = sha256Base64Url(codeVerifier);
    await storeOAuthState('etsy', state, { codeVerifier, redirectAfter: '/' }, req);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.etsy.clientId,
      redirect_uri: config.etsy.redirectUri,
      scope: config.etsy.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    res.redirect(`${config.etsy.authorizationUrl}?${params}`);
  } catch (error) {
    next(error);
  }
});

router.get('/etsy/callback', async (req, res, next) => {
  try {
    if (req.query.error) {
      throw new Error(`Etsy authorization failed: ${req.query.error_description || req.query.error}`);
    }

    const state = await consumeOAuthState('etsy', req.query.state);
    if (!state) throw new Error('Etsy OAuth state is missing or expired.');
    if (!req.query.code) throw new Error('Etsy callback did not include a code.');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.etsy.clientId,
      redirect_uri: config.etsy.redirectUri,
      code: req.query.code,
      code_verifier: state.code_verifier
    });

    if (config.etsy.clientSecret) {
      body.set('client_secret', config.etsy.clientSecret);
    }

    const response = await fetch(config.etsy.tokenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-api-key': apiKeyHeader()
      },
      body
    });
    const text = await response.text();
    const token = text ? JSON.parse(text) : {};

    if (!response.ok || !token.access_token) {
      throw new Error(`Etsy token exchange failed: ${response.status}. Check the app credentials and try authorization again.`);
    }

    token.expires_at = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    if(!config.etsy.shopId){
      const userId=String(token.access_token).split('.')[0];
      if(!/^\d+$/.test(userId))throw new Error('Etsy shop could not be identified. Enter the shop ID and authorize again.');
      const shopResponse=await fetch(`${config.etsy.apiBaseUrl}/users/${userId}/shops`,{headers:{'x-api-key':apiKeyHeader()},signal:AbortSignal.timeout(30000)});
      if(!shopResponse.ok)throw new Error('Etsy shop lookup failed. Try authorization again or contact support.');
      const shop=await shopResponse.json();if(!/^\d+$/.test(String(shop.shop_id||'')))throw new Error('Etsy returned no shop ID.');
      const store=require('../settings/store'),saved=store.read();saved.values.ETSY_SHOP_ID=String(shop.shop_id);store.write(saved);config.etsy.shopId=String(shop.shop_id);
    }
    await setToken('etsy', token);
    res.redirect(state.redirect_after || '/');
  } catch (error) {
    next(error);
  }
});

router.get('/shopify/start', require('../middleware/basicAuth').basicAuth, require('../middleware/sameOrigin').sameOrigin, async (req, res, next) => {
  try {
    if (!config.shopify.clientId || !config.shopify.shopDomain) {
      throw new Error('SHOPIFY_CLIENT_ID and SHOPIFY_SHOP_DOMAIN are required.');
    }
    const state = randomToken(24);
    await storeOAuthState('shopify', state, { redirectAfter: '/' }, req);
    const raw = config.shopify.shopDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const shopHost = raw.includes('.') ? raw : `${raw}.myshopify.com`;
    const params = new URLSearchParams({
      client_id: config.shopify.clientId,
      scope: config.shopify.scopes,
      redirect_uri: config.shopify.redirectUri,
      state
    });
    res.redirect(`https://${shopHost}/admin/oauth/authorize?${params}`);
  } catch (error) {
    next(error);
  }
});

router.get('/shopify/callback', async (req, res, next) => {
  try {
    if (req.query.error) {
      throw new Error(`Shopify authorization failed: ${req.query.error_description || req.query.error}`);
    }
    const state = await consumeOAuthState('shopify', req.query.state);
    if (!state) throw new Error('Shopify OAuth state is missing or expired.');
    if (!req.query.code) throw new Error('Shopify callback did not include a code.');

    const raw = config.shopify.shopDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const shopHost = raw.includes('.') ? raw : `${raw}.myshopify.com`;
    const response = await fetch(`https://${shopHost}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.shopify.clientId,
        client_secret: config.shopify.clientSecret,
        code: req.query.code
      })
    });
    const text = await response.text();
    const token = text ? JSON.parse(text) : {};

    if (!response.ok || !token.access_token) {
      throw new Error(`Shopify token exchange failed: ${response.status} ${text}`);
    }

    await setToken('shopify', token);
    res.redirect(state.redirect_after || '/');
  } catch (error) {
    next(error);
  }
});

router.get('/amazon/start', require('../middleware/basicAuth').basicAuth, require('../middleware/sameOrigin').sameOrigin, async (req, res, next) => {
  try {
    assertAmazonAuthConfigured();
    const state = randomToken(24);
    await storeOAuthState('amazon', state, { redirectAfter: '/' }, req);
    const params = new URLSearchParams({
      application_id: config.amazon.applicationId,
      state
    });

    if (config.amazon.authVersion) {
      params.set('version', config.amazon.authVersion);
    }

    res.redirect(`${config.amazon.sellerCentralUrl}/apps/authorize/consent?${params}`);
  } catch (error) {
    next(error);
  }
});

router.get('/amazon/login', require('../middleware/basicAuth').basicAuth, require('../middleware/sameOrigin').sameOrigin, async (req, res, next) => {
  try {
    assertAmazonAuthConfigured();

    if (!req.query.amazon_state) {
      throw new Error('Amazon login request did not include amazon_state.');
    }

    const amazonCallbackUri = validateAmazonCallbackUri(req.query.amazon_callback_uri);
    const state = randomToken(24);
    await storeOAuthState('amazon', state, { redirectAfter: '/' }, req);

    amazonCallbackUri.searchParams.set('redirect_uri', config.amazon.redirectUri);
    amazonCallbackUri.searchParams.set('amazon_state', req.query.amazon_state);
    amazonCallbackUri.searchParams.set('state', state);

    if (req.query.version || config.amazon.authVersion) {
      amazonCallbackUri.searchParams.set('version', req.query.version || config.amazon.authVersion);
    }

    res.redirect(amazonCallbackUri.toString());
  } catch (error) {
    next(error);
  }
});

router.get('/amazon/callback', async (req, res, next) => {
  try {
    if (req.query.error) {
      throw new Error(`Amazon authorization failed: ${req.query.error_description || req.query.error}`);
    }

    const incomingState = req.query.state || req.query.amazon_state;
    const state = await consumeOAuthState('amazon', incomingState);
    if (!state) throw new Error('Amazon OAuth state is missing or expired.');

    const code = req.query.spapi_oauth_code || req.query.code;
    if (!code) throw new Error('Amazon callback did not include an authorization code.');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.amazon.lwaClientId,
      client_secret: config.amazon.lwaClientSecret,
      redirect_uri: config.amazon.redirectUri
    });

    const response = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const text = await response.text();
    const token = text ? JSON.parse(text) : {};

    if (!response.ok || !token.refresh_token) {
      throw new Error(`Amazon token exchange failed: ${response.status} ${text}`);
    }

    token.expires_at = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    token.selling_partner_id = req.query.selling_partner_id || '';
    await setToken('amazon_lwa', token);
    res.redirect(state.redirect_after || '/');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
