import { writeFile } from "node:fs/promises";
const target = new URL(
  "../tests/fixtures/broken-project/src.js",
  import.meta.url,
);
await writeFile(
  target,
  "// Deliberate syntax error for the coding-agent repair test.\nconst result = ;\nconsole.log(result);\n",
);
console.log(
  "Reset the disposable repair fixture to its intentionally broken state.",
);
