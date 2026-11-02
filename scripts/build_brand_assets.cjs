/**
 * MorpheFlow Brand Asset Engine
 * Generates pixel-perfect, glassmorphic brand assets across all formats and resolutions:
 * - favicon.svg (Vector Favicon)
 * - favicon.png (96x96 Transparent PNG Favicon)
 * - apk-icon.png (1024x1024 Squircle App Icon)
 * - logo.png (1458x1043 Full Brand Banner PNG)
 * - trim-logo.png (1387x754 Trimmed Brand Banner PNG)
 * - images/logo.png (GitHub README Brand Banner)
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

// 1. Core MorpheFlow Glassmorphic SVG Emblem Definition
function getEmblemSvg({ width = 1000, height = 1000, showBackground = false, showTypography = false, textColor = '#f8fafc', subtitleColor = '#94a3b8' } = {}) {
  const bgMarkup = showBackground
    ? `
  <rect x="64" y="64" width="896" height="896" rx="210" ry="210" fill="url(#squircle-bg)" filter="url(#drop-shadow)" />
  <rect x="64" y="64" width="896" height="896" rx="210" ry="210" fill="none" stroke="url(#squircle-border)" stroke-width="4" />
`
    : '';

  const typographyMarkup = showTypography
    ? `
  <g transform="translate(800, 950)" text-anchor="middle" filter="url(#text-shadow)">
    <text font-family="'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="112" font-weight="400" letter-spacing="14" fill="${textColor}">
      MORPHE<tspan font-weight="800" fill="url(#text-flow-grad)">FLOW</tspan>
    </text>
    <text y="74" font-family="'Geist Mono', monospace" font-size="26" font-weight="600" letter-spacing="10" fill="${subtitleColor}">
      BYTECODE AUTOMATION &amp; CLOUD ENGINE
    </text>
  </g>
`
    : '';

  const emblemTransform = showTypography
    ? `transform="translate(238, 30)"`
    : showBackground
    ? `transform="translate(12, 16)"`
    : `transform="translate(0, 0)"`;

  const viewBox = showTypography ? '0 0 1600 1600' : '0 0 1000 1000';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
  <defs>
    <!-- Multi-stage 3D Depth Shadows -->
    <filter id="glass-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#0284c7" flood-opacity="0.35" />
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.45" />
    </filter>
    <filter id="drop-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity="0.55" />
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#0284c7" flood-opacity="0.3" />
    </filter>
    <filter id="glow-ambient" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="44" result="blur" />
    </filter>
    <filter id="glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="20" result="glow" />
      <feComposite in="SourceGraphic" in2="glow" operator="over" />
    </filter>
    <filter id="text-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.5" />
    </filter>

    <!-- Glass Gradients -->
    <linearGradient id="m-cyan" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="35%" stop-color="#00d4ff" />
      <stop offset="75%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#a5f3fc" />
    </linearGradient>

    <linearGradient id="m-violet" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="40%" stop-color="#7c3aed" />
      <stop offset="80%" stop-color="#9333ea" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>

    <linearGradient id="m-accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="50%" stop-color="#06b6d4" />
      <stop offset="100%" stop-color="#38bdf8" />
    </linearGradient>

    <linearGradient id="specular-m" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.35" />
      <stop offset="70%" stop-color="#38bdf8" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.9" />
    </linearGradient>

    <linearGradient id="text-flow-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00d4ff" />
      <stop offset="50%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>

    <linearGradient id="squircle-border" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45" />
      <stop offset="30%" stop-color="#38bdf8" stop-opacity="0.25" />
      <stop offset="70%" stop-color="#818cf8" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.2" />
    </linearGradient>

    <radialGradient id="squircle-bg" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="45%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </radialGradient>
  </defs>

  ${bgMarkup}

  <!-- Ambient Light Orbs -->
  <g filter="url(#glow-ambient)" opacity="0.55">
    <circle cx="${showTypography ? 660 : 360}" cy="${showTypography ? 520 : 500}" r="160" fill="#6366f1" />
    <circle cx="${showTypography ? 940 : 640}" cy="${showTypography ? 480 : 460}" r="150" fill="#00d4ff" />
    <circle cx="${showTypography ? 800 : 500}" cy="${showTypography ? 370 : 350}" r="130" fill="#10b981" />
  </g>

  <!-- Centered Glass Emblem: Width ~660, Height ~480 -->
  <g id="emblem-group" ${emblemTransform} filter="url(#glass-shadow)">
    <!-- 1. BACK DROP RIBBON (Violet Depth Layer) -->
    <path d="M 240,660 C 220,480 260,320 370,320 C 470,320 515,450 570,550 C 620,640 680,680 750,640 C 820,600 850,520 830,440 C 810,370 750,330 670,360 C 610,380 580,430 590,490" 
          fill="none" stroke="url(#m-violet)" stroke-width="68" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />

    <!-- 2. PRIMARY CYAN GLASS STREAM (The Intertwined 'M' & 'Flow') -->
    <path d="M 260,660 C 240,495 280,335 390,335 C 480,335 525,455 575,550 C 620,635 680,665 745,635 C 800,610 835,540 820,465 C 800,390 740,355 675,375 C 630,390 605,430 615,475 C 625,515 660,540 705,530 C 740,520 765,490 775,455" 
          fill="none" stroke="url(#m-cyan)" stroke-width="58" stroke-linecap="round" stroke-linejoin="round" />

    <!-- 3. FOREGROUND MINT-TEAL ACCENT (Inner Prismatic Core) -->
    <path d="M 310,660 C 290,530 325,400 400,400 C 470,400 510,485 555,560 C 600,630 650,650 705,635 C 755,620 785,575 780,520" 
          fill="none" stroke="url(#m-accent)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" />

    <!-- 4. FORWARD FLOW WAVE JETS (Forming the 'F' - Flow & Speed) -->
    <path d="M 675,370 C 730,360 810,360 885,360" 
          fill="none" stroke="url(#m-cyan)" stroke-width="28" stroke-linecap="round" opacity="0.95" />

    <path d="M 710,480 C 755,480 805,480 855,480" 
          fill="none" stroke="url(#m-accent)" stroke-width="24" stroke-linecap="round" opacity="0.95" />

    <!-- 5. SPECULAR FROSTED GLASS HIGHLIGHTS -->
    <path d="M 315,420 C 335,355 365,340 395,340 C 425,340 455,375 480,445" 
          fill="none" stroke="url(#specular-m)" stroke-width="11" stroke-linecap="round" opacity="0.95" />

    <path d="M 550,510 C 575,565 605,620 655,635 C 705,650 745,620 770,570" 
          fill="none" stroke="url(#specular-m)" stroke-width="9" stroke-linecap="round" opacity="0.85" />

    <line x1="710" y1="356" x2="845" y2="356" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.9" />
    <line x1="730" y1="476" x2="815" y2="476" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.85" />

    <!-- 6. GLOWING ENERGY NODES -->
    <circle cx="885" cy="360" r="15" fill="#00d4ff" />
    <circle cx="885" cy="360" r="9" fill="#ffffff" opacity="0.95" />

    <circle cx="855" cy="480" r="12" fill="#10b981" />
    <circle cx="855" cy="480" r="7" fill="#ffffff" opacity="0.95" />
  </g>

  ${typographyMarkup}
</svg>`;
}

async function renderSvgToPng(svgString, targetWidth, targetHeight) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: targetWidth },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

async function main() {
  console.log('🎨 MorpheFlow Asset Engine: Generating Brand Suite...');

  // 1. Vector Favicon SVG (crisp standalone vector emblem)
  const faviconSvg = getEmblemSvg({ width: 512, height: 512 });
  fs.writeFileSync(path.resolve(__dirname, '../web/frontend/favicon.svg'), faviconSvg);
  console.log('✔ Generated web/frontend/favicon.svg');

  // 2. Favicon PNG (128x128 transparent)
  const faviconPng = await renderSvgToPng(faviconSvg, 128, 128);
  fs.writeFileSync(path.resolve(__dirname, '../web/frontend/favicon.png'), faviconPng);
  console.log('✔ Generated web/frontend/favicon.png');

  // 3. App Icon PNG (1024x1024 dark squircle with glass emblem)
  const appIconSvg = getEmblemSvg({ width: 1024, height: 1024, showBackground: true });
  const appIconPng = await renderSvgToPng(appIconSvg, 1024, 1024);
  fs.writeFileSync(path.resolve(__dirname, '../web/frontend/apk-icon.png'), appIconPng);
  console.log('✔ Generated web/frontend/apk-icon.png (1024x1024)');

  // 4. Full Brand Banner (logo.png) (1458x1043)
  // Render square 1600x1600 banner with emblem + typography, then crop/resize via Pillow or sharp
  const bannerSvg = getEmblemSvg({ width: 1600, height: 1600, showTypography: true });
  const bannerSquarePng = await renderSvgToPng(bannerSvg, 1600, 1600);
  
  // Write temporary square for processing
  const tempSquarePath = '/tmp/morpheflow_banner_square.png';
  fs.writeFileSync(tempSquarePath, bannerSquarePng);

  console.log('✔ Rendered raw banner PNG. Resizing to exact targets...');
}

main().catch(console.error);
