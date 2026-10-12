require('dotenv').config();
require('./settings/store').apply();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function marketplaceMap(value) {
  const entries = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const result = {};

  for (const entry of entries) {
    const [key, id] = entry.split(':').map((part) => String(part || '').trim());
    if (key && id) result[key.toLowerCase()] = id;
  }

  return result;
}

const port = number(process.env.PORT, 3080);

const config = {
  marketplaceCallbacksEnabled: bool(process.env.MARKETPLACE_CALLBACKS_ENABLED, false),
  supportEmail: process.env.SUPPORT_EMAIL ?? 'miroslav@miroslavbakos.com',
  env: process.env.NODE_ENV || 'development',
  port,
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
  appSecret: process.env.APP_SECRET || '',
  basicAuthUser: process.env.APP_BASIC_AUTH_USER || '',
  basicAuthPassword: process.env.APP_BASIC_AUTH_PASSWORD || '',
  databaseUrl: process.env.DATABASE_URL || 'postgres://orders:orders@localhost:5432/orders',
  backupCopyDir: process.env.BACKUP_COPY_DIR || '',
  labelRetentionDays: number(process.env.LABEL_RETENTION_DAYS, 0),
  webPushEnabled: bool(process.env.WEB_PUSH_ENABLED, false),
  webPushSubject: process.env.WEB_PUSH_SUBJECT || '',
  pollIntervalMinutes: number(process.env.POLL_INTERVAL_MINUTES, 15),
  pollOverlapMinutes: number(process.env.POLL_OVERLAP_MINUTES, 30),
  initialLookbackDays: number(process.env.INITIAL_LOOKBACK_DAYS, 30),
  pollOnStart: bool(process.env.POLL_ON_START, true),
  etsy: {
    enabled: bool(process.env.ETSY_ENABLED, false),
    clientId: process.env.ETSY_CLIENT_ID || '',
    clientSecret: process.env.ETSY_CLIENT_SECRET || '',
    shopId: process.env.ETSY_SHOP_ID || '',
    scopes: list(process.env.ETSY_SCOPES || 'transactions_r transactions_w listings_r listings_w'),
    redirectUri: process.env.ETSY_REDIRECT_URI || `${process.env.APP_BASE_URL || `http://localhost:${port}`}/auth/etsy/callback`,
    tokenUrl: 'https://api.etsy.com/v3/public/oauth/token',
    authorizationUrl: 'https://www.etsy.com/oauth/connect',
    apiBaseUrl: 'https://api.etsy.com/v3/application'
  },
  shopify: {
    authMode: process.env.SHOPIFY_AUTH_MODE || 'oauth',
    enabled: bool(process.env.SHOPIFY_ENABLED, false),
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN || '',
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
    clientId: process.env.SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
    adminOrderUrlTemplate: process.env.SHOPIFY_ADMIN_ORDER_URL_TEMPLATE || '',
    scopes: process.env.SHOPIFY_SCOPES || 'read_orders,read_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders',
    redirectUri: process.env.SHOPIFY_REDIRECT_URI || `${process.env.APP_BASE_URL || `http://localhost:${port}`}/auth/shopify/callback`
  },
  amazon: {
    enabled: bool(process.env.AMAZON_ENABLED, false),
    ordersApiVersion: process.env.AMAZON_ORDERS_API_VERSION || '2026-01-01',
    authMode: process.env.AMAZON_AUTH_MODE || 'private',
    applicationId: process.env.AMAZON_APPLICATION_ID || '',
    sellerCentralUrl: (process.env.AMAZON_SELLER_CENTRAL_URL || 'https://sellercentral-europe.amazon.com').replace(/\/+$/, ''),
    authVersion: process.env.AMAZON_AUTH_VERSION || '',
    lwaClientId: process.env.AMAZON_LWA_CLIENT_ID || '',
    lwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
    awsAccessKeyId: process.env.AMAZON_AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AMAZON_AWS_SECRET_ACCESS_KEY || '',
    regionGroup: process.env.AMAZON_REGION_GROUP || 'eu',
    marketplaceIds: marketplaceMap(process.env.AMAZON_MARKETPLACE_IDS || ''),
    redirectUri: process.env.AMAZON_REDIRECT_URI || `${process.env.APP_BASE_URL || `http://localhost:${port}`}/auth/amazon/callback`,
    fetchAddress: bool(process.env.AMAZON_FETCH_ADDRESS, false)
  },
  sashe: {
    enabled: bool(process.env.SASHE_ENABLED, false),
    userId: process.env.SASHE_USER_ID || '',
    apiKey: process.env.SASHE_API_KEY || ''
  },
  shipping: {
    gls: {
      apiUrl: process.env.GLS_API_URL || 'https://api.mygls.sk/',
      username: process.env.GLS_USERNAME || '',
      password: process.env.GLS_PASSWORD || '',
      clientNumber: process.env.GLS_CLIENT_NUMBER || '',
      defaultCountryIso: process.env.GLS_DEFAULT_COUNTRY_ISO || 'SK',
      pickupAddress: {
        name: process.env.GLS_PICKUP_NAME || '',
        contactName: process.env.GLS_PICKUP_CONTACT_NAME || '',
        contactPhone: process.env.GLS_PICKUP_CONTACT_PHONE || '',
        contactEmail: process.env.GLS_PICKUP_CONTACT_EMAIL || '',
        street: process.env.GLS_PICKUP_STREET || '',
        houseNumber: process.env.GLS_PICKUP_HOUSE_NUMBER || '',
        houseNumberInfo: process.env.GLS_PICKUP_HOUSE_NUMBER_INFO || '',
        city: process.env.GLS_PICKUP_CITY || '',
        zipCode: process.env.GLS_PICKUP_ZIP_CODE || '',
        countryIsoCode: process.env.GLS_PICKUP_COUNTRY_ISO || 'SK'
      }
    },
    posta: {
      baseUrl: process.env.POSTA_BASE_URL || 'https://mojezasielky.posta.sk/integration/rest/v1',
      userId: process.env.POSTA_USER_ID || '',
      apiKey: process.env.POSTA_API_KEY || '',
      registeredLetterCategory: process.env.POSTA_REGISTERED_LETTER_CATEGORY || 'r',
      registeredLetterWeightKg: number(process.env.POSTA_REGISTERED_LETTER_WEIGHT_KG, 0.5),
      registeredLetterCustomsValueEur: number(process.env.POSTA_REGISTERED_LETTER_CUSTOMS_VALUE_EUR, 10),
      parcelCategory: process.env.POSTA_PARCEL_CATEGORY || 'b',
      parcelWeightKg: number(process.env.POSTA_PARCEL_WEIGHT_KG, 2.3),
      parcelCustomsValueEur: number(process.env.POSTA_PARCEL_CUSTOMS_VALUE_EUR, 34),
      receptionMethod: process.env.POSTA_RECEPTION_METHOD || 'post',
      paymentType: process.env.POSTA_PAYMENT_TYPE || 'up',
      contract: bool(process.env.POSTA_CONTRACT, true),
      ownParcelNumbers: bool(process.env.POSTA_OWN_PARCEL_NUMBERS, false),
      skipParcelNumbers: bool(process.env.POSTA_SKIP_PARCEL_NUMBERS, false),
      packaging: process.env.POSTA_PACKAGING || 'standard',
      customsCategory: process.env.POSTA_CUSTOMS_CATEGORY || 'gift',
      customsDescription: process.env.POSTA_CUSTOMS_DESCRIPTION || 'Toys and games',
      customsTariffNumber: process.env.POSTA_CUSTOMS_TARIFF_NUMBER || '950300',
      customsOriginCountry: process.env.POSTA_CUSTOMS_ORIGIN_COUNTRY || 'SK',
      sender: {
        name: process.env.POSTA_SENDER_NAME || '',
        organization: process.env.POSTA_SENDER_ORGANIZATION || '',
        street: process.env.POSTA_SENDER_STREET || '',
        city: process.env.POSTA_SENDER_CITY || '',
        zip: process.env.POSTA_SENDER_ZIP || '',
        country: process.env.POSTA_SENDER_COUNTRY || 'SK',
        phone: process.env.POSTA_SENDER_PHONE || '',
        email: process.env.POSTA_SENDER_EMAIL || ''
      }
    }
  }
};

module.exports = { config, bool, number, list };
