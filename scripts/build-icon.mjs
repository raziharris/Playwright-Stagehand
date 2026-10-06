import fs from 'node:fs';
import pngToIco from 'png-to-ico';

const icon = await pngToIco('assets/qa-orbit-icon.png');
fs.writeFileSync('assets/qa-orbit.ico', icon);
console.log(`Created Windows icon (${icon.length} bytes).`);
