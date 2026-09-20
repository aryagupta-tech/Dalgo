export default {
  id: 54,
  name: 'C++ (GCC 9.4.0)',
  is_archived: false,
  source_file: 'main.cpp',
  compile_cmd: 'g++ -O2 -std=c++17 -I/usr/local/include -o main *.cpp',
  run_cmd: './main',
  image: 'codebox/gcc:9',
  // nlohmann/json.hpp needs ~512MB to compile
  min_memory: 512000,
};
