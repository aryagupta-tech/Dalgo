export default {
  id: 50,
  name: 'C (GCC 9.4.0)',
  is_archived: false,
  source_file: 'main.c',
  compile_cmd: 'gcc -O2 -std=c17 -o main main.c -lm',
  run_cmd: './main',
  image: 'codebox/gcc:9',
};
