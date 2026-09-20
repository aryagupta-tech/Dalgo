export default {
  id: 74,
  name: 'TypeScript (5.0.3)',
  is_archived: false,
  source_file: 'ts-main.ts',
  compile_cmd: 'rm -rf node_modules/@types 2>/dev/null; tsc ts-main.ts --outDir . --esModuleInterop --skipLibCheck --typeRoots /usr/lib/node_modules/@types',
  run_cmd: 'node ts-main.js',
  image: 'codebox/typescript:5',
  // tsc needs ~400MB to load the type system; container must allow this during compilation
  min_memory: 512000,
};
