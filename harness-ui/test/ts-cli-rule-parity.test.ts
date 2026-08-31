// TS ↔ CLI **규칙 존재** 대조 — `behavior-parity.test.ts` 가 *판정*을 대조한다면 이건 *규칙*을 대조한다.
//
// 왜 둘 다 필요한가: 판정 대조는 **테스트한 입력**에 대해서만 참이다(B2 R3 에서 "CLI 는 이 오탐이
// 없다"고 실측 확인했는데 다른 입력에서 반대 방향 갈라짐이 나왔다). 규칙 대조는 한쪽에만 들어간
// 규칙을 **입력 없이도** 드러낸다 — 이번 세션에서 한쪽만 고쳐 갈라진 사례가 5회 있었다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../..");
const ts = readFileSync(join(REPO, "harness-ui/src/server/adapters/artifacteval.ts"), "utf8");
const sc = readFileSync(join(REPO, "harness-ui/src/server/adapters/scorecard.ts"), "utf8");
const hn = readFileSync(join(REPO, "harness-ui/src/server/adapters/harness.ts"), "utf8");
const sh = readFileSync(join(REPO, "skills/myharness/scripts/check-behaviors.sh"), "utf8");
const TS_ALL = ts + sc + hn;

describe("TS ↔ CLI 규칙 존재 대조", () => {
  it.each([
    ["fence 는 3개 이상이고 길이를 비교한다", /`\{3,\}|~\{3,\}/, /`\{3,\}|~\{3,\}/],
    ["주석과 펜스는 서로를 가린다", /fenceToken\(l\) === null/, /inc \|\| !isfence/],
    ["BOM 을 허용하지 않는다", /\^---\\r\?\\n/, /head -1 .* tr -d/],
    ["name 정규식은 연속 하이픈을 허용한다", /\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?/, /\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?/],
    ["256KB 읽기 캡", /262144/, /262144/],
    ["스펙 순회 상한 500", /MAX_BEHAVIOR_DIRS = 500/, /MAX_SPECS=500/],
    ["차원 heading 은 exact match", /isDimensionHeading/, /\^##\[\[:space:\]\]\+" dim "\$/],
    ["심링크를 따라간다(스킬 스캔)", /\.agents\/skills/, /find -L \.agents\/skills/],
    ["TOML behaviors 는 미지원으로 보고", /TOML 에이전트의 behaviors/, /TOML 에이전트의 behaviors/],
  ])("%s — 양쪽에 존재", (_n, tsPat, shPat) => {
    expect(tsPat.test(TS_ALL), "TS 에 없다").toBe(true);
    expect(shPat.test(sh), "CLI 에 없다").toBe(true);
  });

  it("한쪽에만 있는 규칙을 새로 넣으면 이 테스트에 항목을 추가해야 한다(운영 규약)", () => {
    // 이 테스트의 목적은 목록 자체다 — 규칙을 추가할 때 여기 한 줄이 늘지 않으면
    // 두 구현이 갈라진 채로 통과한다. 목록이 비지 않았는지만 확인한다.
    expect(TS_ALL.length).toBeGreaterThan(1000);
    expect(sh.length).toBeGreaterThan(1000);
  });
});
