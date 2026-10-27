import typescript from "@rollup/plugin-typescript";
import { dts } from "rollup-plugin-dts";

// One build per public entry point so `fs` never leaks into the core bundle.
const entries = ["index", "fs"];
const external = [/^node:/];

export default entries.flatMap((name) => [
  {
    input: `src/${name}.ts`,
    external,
    plugins: [typescript()],
    output: [
      { file: `dist/${name}.mjs`, format: "es" },
      { file: `dist/${name}.cjs`, format: "cjs" },
    ],
  },
  {
    input: `src/${name}.ts`,
    external,
    plugins: [dts()],
    output: [{ file: `dist/${name}.d.mts` }, { file: `dist/${name}.d.cts` }],
  },
]);
