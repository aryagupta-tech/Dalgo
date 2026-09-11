import type { Language, Problem } from "../shared/types";
export const RESULT_MARKER = "__DALGO_RESULT__";
function literal(v: unknown, t: string, lang: Language): string {
  if (t === "int") return String(v);
  if (t === "string") return JSON.stringify(v);
  if (t.endsWith("[]")) {
    const subtype = t.slice(0, -2);
    const values = (v as unknown[])
      .map((x) => literal(x, subtype, lang))
      .join(",");
    if (lang === "java") {
      const type = t.replace("string", "String");
      return `new ${type}{${values}}`;
    }
    const type = cppType(t);
    return `${type}{${values}}`;
  }
  throw new Error("Unsupported fixture type");
}
function cppType(t: string): string {
  if (t === "int") return "int";
  if (t === "string") return "std::string";
  if (t.endsWith("[]")) return `std::vector<${cppType(t.slice(0, -2))}>`;
  throw new Error("Unsupported type");
}
export function buildHarness(
  problem: Problem,
  language: Language,
  source: string,
  kind: "run" | "submit",
) {
  const cases = kind === "run" ? problem.examples : problem.tests;
  const args = cases.map((t) => t.args);
  if (language === "javascript")
    return `${source}\n;const __dalgoCases = ${JSON.stringify(args)};\nconst __dalgoOut = __dalgoCases.map(args => solve(...args));\nprocess.stdout.write('\\n${RESULT_MARKER}'+JSON.stringify(__dalgoOut)+'\\n');`;
  if (language === "python")
    return `import json, math, collections, functools, itertools, heapq, bisect\nfrom typing import *\n${source}\n__dalgo_cases = json.loads(${JSON.stringify(JSON.stringify(args))})\n__dalgo_out = [solve(*args) for args in __dalgo_cases]\nprint('\\n${RESULT_MARKER}'+json.dumps(__dalgo_out,separators=(',',':')))\n`;
  if (language === "cpp") {
    const calls = args
      .map(
        (a) =>
          `__dalgo_emit(solve(${a.map((x, i) => literal(x, problem.parameters[i].type, language)).join(",")}));`,
      )
      .join(` std::cout<<",";\n`);
    return `#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <unordered_map>\n#include <unordered_set>\n#include <map>\n#include <set>\n#include <queue>\n#include <stack>\n#include <deque>\n#include <limits>\n#include <numeric>\n#include <functional>\n#include <utility>\n#include <cmath>\n#include <climits>\nusing namespace std;\n${source}\nvoid __dalgo_emit(int x){std::cout<<x;}\nvoid __dalgo_emit(const std::string& s){std::cout<<'"';for(unsigned char c:s){if(c=='"'||c=='\\\\')std::cout<<'\\\\'<<c;else if(c=='\\n')std::cout<<"\\\\n";else if(c=='\\r')std::cout<<"\\\\r";else if(c=='\\t')std::cout<<"\\\\t";else if(c<32){const char* h="0123456789abcdef";std::cout<<"\\\\u00"<<h[c>>4]<<h[c&15];}else std::cout<<c;}std::cout<<'"';}\ntemplate<class T>void __dalgo_emit(const std::vector<T>& v){std::cout<<'[';for(size_t i=0;i<v.size();++i){if(i)std::cout<<',';__dalgo_emit(v[i]);}std::cout<<']';}\nint main(){std::cout<<"\\n${RESULT_MARKER}[";${calls}std::cout<<"]\\n";}\n`;
  }
  const calls = args
    .map(
      (a) =>
        `__dalgo_emit(solve(${a.map((x, i) => literal(x, problem.parameters[i].type, language)).join(",")}));`,
    )
    .join(` System.out.print(",");\n`);
  return `import java.util.*;\nimport java.io.*;\nimport java.math.*;\npublic class Main {\n${source}\nstatic void __dalgo_emit(Object o){if(o==null){System.out.print("null");return;}if(o instanceof String){String s=(String)o;System.out.print('"');for(int i=0;i<s.length();i++){char c=s.charAt(i);if(c=='"'||c=='\\\\'){System.out.print('\\\\');System.out.print(c);}else if(c=='\\n')System.out.print("\\\\n");else if(c=='\\r')System.out.print("\\\\r");else if(c=='\\t')System.out.print("\\\\t");else if(c<32)System.out.printf("\\\\u%04x",(int)c);else System.out.print(c);}System.out.print('"');}else if(o.getClass().isArray()){System.out.print('[');for(int i=0;i<java.lang.reflect.Array.getLength(o);i++){if(i>0)System.out.print(',');__dalgo_emit(java.lang.reflect.Array.get(o,i));}System.out.print(']');}else System.out.print(o);}\npublic static void main(String[]args){System.out.print("\\n${RESULT_MARKER}[");${calls}System.out.print("]\\n");}\n}`;
}
export function compareOutputs(output: string, expected: unknown[]) {
  const marker = "\n" + RESULT_MARKER;
  const start = output.lastIndexOf(marker);
  if (start < 0)
    return { valid: false, passed: false, actual: [] as unknown[] };
  const raw = output.slice(start + marker.length).trim();
  try {
    const actual = JSON.parse(raw);
    if (!Array.isArray(actual) || actual.length !== expected.length)
      return { valid: false, passed: false, actual: [] };
    return {
      valid: true,
      passed: JSON.stringify(actual) === JSON.stringify(expected),
      actual,
    };
  } catch {
    return { valid: false, passed: false, actual: [] };
  }
}
