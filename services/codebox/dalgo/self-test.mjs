import { execution } from "./protocol.mjs";
export async function selfTest(executor) {
  const programs = [
    [71, 'print("dalgo")'],
    [54, '#include <iostream>\nint main(){std::cout<<"dalgo";}'],
    [
      62,
      'public class Main {public static void main(String[] a){System.out.print("dalgo");}}',
    ],
    [63, 'console.log("dalgo")'],
  ];
  for (const [language_id, source_code] of programs) {
    const result = await executor.execute(
      execution({ token: "self-test", language_id, source_code }),
    );
    if (result.status.id !== 3 || result.stdout?.trim() !== "dalgo")
      throw new Error(
        `Sandbox startup check failed for language ${language_id}: ${result.status.id}`,
      );
  }
  const source_code = `import os, socket
assert os.getuid() >= 60000
assert {line.split(':')[0].strip() for line in open('/proc/net/dev') if ':' in line} <= {'lo'}
assert not os.path.exists('/app')
assert not os.path.exists('/sys/fs/cgroup')
assert 'AUTH_TOKEN' not in os.environ and 'REDIS_URL' not in os.environ
for host, port in [('1.1.1.1', 53), ('169.254.169.254', 80), ('127.0.0.1', 3000)]:
    s = socket.socket(); s.settimeout(0.2)
    assert s.connect_ex((host, port)) != 0
    s.close()
print('isolated')`;
  const result = await executor.execute(
    execution({ token: "self-test", language_id: 71, source_code }),
  );
  if (result.status.id !== 3 || result.stdout?.trim() !== "isolated")
    throw new Error("Sandbox isolation check failed");
}
