export default {
  id: 62,
  name: 'Java (OpenJDK 17)',
  is_archived: false,
  source_file: 'Main.java',
  compile_cmd: 'javac -cp .:/usr/local/lib/java/* *.java',
  run_cmd: 'java -cp .:/usr/local/lib/java/* Main',
  image: 'codebox/java:17',
};
