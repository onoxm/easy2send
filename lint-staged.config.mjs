export default {
  '**/*.{js,ts,tsx,md,json,css,scss,html,mjs}': 'oxfmt',
  'src/**/*.{js,ts,tsx}': 'sh -c "pnpm run build"'
}
