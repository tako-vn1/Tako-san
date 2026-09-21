import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Public Google Fonts files used by index.html, pinned for offline visual tests.
const root = 'tests/e2e/t17-ui/fonts';
const faces = {
  400: 'XRXI3I6Li01BKofiOc5wtlZ2di8HDLshRTM',
  500: 'XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhRTM',
  600: 'XRXI3I6Li01BKofiOc5wtlZ2di8HDGUmRTM',
  700: 'XRXI3I6Li01BKofiOc5wtlZ2di8HDFwmRTM',
  800: 'XRXI3I6Li01BKofiOc5wtlZ2di8HDDsmRTM',
};
await mkdir(root, { recursive: true });
const manifest = [];
for (const [weight, id] of Object.entries(faces)) {
  const source = `https://fonts.gstatic.com/s/nunito/v32/${id}.ttf`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = `nunito-${weight}.ttf`;
  await writeFile(`${root}/${file}`, bytes);
  manifest.push({ file, weight: Number(weight), source, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const license = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt');
if (!license.ok) throw new Error(`License download failed: ${license.status}`);
await writeFile(`${root}/OFL.txt`, await license.text());
await writeFile(`${root}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
