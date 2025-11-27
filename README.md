# Otamatone Roll

Otamatone visualization of tunes using ABC notation.

## 🔗 Quick Links

- **Live App**: https://jolly-mushroom-07fca3310.3.azurestaticapps.net/
- **GitHub Actions**: https://github.com/laurent-yin/otamatone-roll/actions
- **Repository**: https://github.com/laurent-yin/otamatone-roll

## 🚀 Development

Built with:

- React 18
- TypeScript
- Vite
- abcjs

### Local Development

```bash
npm install
npm run dev
```

### Testing

- `npm run test` – runs the jsdom-based Vitest suite covering hooks and utilities.
- `npm run test:browser` – executes the Chromium-backed Vitest browser runner so real `.abc` fixtures flow through abcjs into the Otamatone roll. Run `npx playwright install chromium` once to download the browser binary.
- `npm run test:browser:ui` – launches the same suite in a headful Chromium window so you can open DevTools and interactively debug.
