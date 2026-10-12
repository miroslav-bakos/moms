// Embed only validated raster data: favicon SVGs cannot fetch external images.
function circularIcon(logo) {
  if (typeof logo !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)) {
    throw new Error('A raster logo data URL is required.');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><clipPath id="circle"><circle cx="256" cy="256" r="256"/></clipPath></defs><image width="512" height="512" preserveAspectRatio="xMidYMid slice" clip-path="url(#circle)" href="${logo}"/></svg>`;
}
let cachedLogo, images = new Map();
async function installIcon(logo, size) {
  if (![180,192,512].includes(size)) throw new Error('Unsupported app icon size.');
  if (logo) circularIcon(logo); // Share the strict embedded raster validation.
  if (cachedLogo !== logo) { cachedLogo = logo; images = new Map(); }
  if (images.has(size)) return images.get(size);
  const source = logo ? Buffer.from(logo.split(',')[1], 'base64') : require('node:path').join(__dirname,'../public/icon-512.png');
  const result = await require('sharp')(source,{limitInputPixels:16777216}).rotate()
    .resize(size,size,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png().toBuffer();
  if (cachedLogo === logo) images.set(size,result);
  return result;
}
module.exports = { circularIcon, installIcon };
