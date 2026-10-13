import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const destination = new URL("../public/vendor/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const [dependency, filename] of [["marked", "marked.js"], ["dompurify", "dompurify.js"]]) {
  await copyFile(fileURLToPath(import.meta.resolve(dependency)), new URL(filename, destination));
}
// Distribute the packages' licenses alongside their locally served browser modules.
await copyFile(new URL("../node_modules/marked/LICENSE", import.meta.url), new URL("marked-LICENSE.txt", destination));
await copyFile(new URL("../node_modules/dompurify/LICENSE", import.meta.url), new URL("dompurify-LICENSE.txt", destination));
