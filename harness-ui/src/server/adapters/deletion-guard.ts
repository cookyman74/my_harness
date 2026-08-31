// 삭제 테스트 가드(B4) — E3(계층B 삭제 판정)이 붙기 **전에** 세우는 방어선.
//
// ⚠ **교체가 아니라 추가다.** 결정적 heading 가드를 검증되지 않은 의미 매핑으로 바꾸면
// 안전성이 **낮아진다**. 가장 위험한 경우는 필수 문장인데 매핑기가 "대응 없음"으로 판정하는
// false negative 이므로, 이 가드는 **대응을 찾지 못한 경우에도 자동 적용을 막는다**.
//
// 이 가드가 막는 것은 **자동 적용**이지 제안이 아니다(계획서 §B4: "매핑 불확실·BEHAVIOR
// 미포괄·판정기 부재 → 자동 삭제 불가(**제안만**)"). 제안은 언제나 가능하고 사람이 판단한다.
//
// **게이트 2(동적 테스트)를 대체하지 않는다.** 이건 3중 게이트의 정적 1층일 뿐이다.
import { REQUIRED_SECTIONS, splitSections } from "./artifacteval.js";

export type GuardInput = {
  /** 삭제 후보 문장(본문 한 줄). */
  line: string;
  /** 그 문장이 속한 섹션의 heading(`## …`). 없으면 빈 문자열. */
  sectionHeading: string;
  kind: "agent" | "skill";
  /** 참조 BEHAVIOR 본문 맵(정의가 `behaviors:` 로 선언한 것). 비어 있으면 "미포괄". */
  behaviorBodies?: ReadonlyMap<string, string>;
  /**
   * **게이트 2(동적 테스트)의 결과.** 이 가드는 3중 게이트의 **정적 1층**일 뿐이고
   * 게이트 2 를 대체하지 않는다(계획서 §B4). 없으면 "판정기 부재" → 자동 적용 불가.
   * E3 가 붙기 전에는 항상 `undefined` 이므로 **자동 삭제는 어느 문장에서도 일어나지 않는다** —
   * 그게 이 단계의 의도된 상태다(가드 먼저, 삭제 판정은 그 다음).
   */
  dynamicGate?: { triggerEvalPassed: boolean; holdoutNoRegression: boolean };
};

export type GuardVerdict = {
  /** 자동 적용을 허용하는가. **제안은 이 값과 무관하게 언제나 가능하다.** */
  autoApply: boolean;
  /** 막은 이유(허용이면 판단 근거). 사람이 읽고 뒤집을 수 있어야 한다. */
  reason: string;
  /** 어느 층이 막았나 — 결정적 가드 / behavior 보존 가드 / 불확실. */
  layer: "deterministic" | "behavior" | "uncertain" | "allow";
};

// 핵심 제약 — 금지·필수 어휘. 이 문장들은 섹션과 무관하게 보존한다.
// (`Failure modes` 가 없던 시절 이 문장들은 협업·작업 원칙에 흩어져 있었다.)
// **넓게 잡는다.** 여기서의 false negative 는 "보존해야 할 제약 문장이 자동 삭제되는 것"이고,
// false positive 는 "지워도 될 문장이 제안에 머무는 것"이다 — 비대칭이 크므로 과탐을 택한다.
const CONSTRAINT = new RegExp([
  // 한국어 부정·금지 — **어미 변화를 덮는다.** `안 된다`만 잡고 `안 됩니다`·`안 되며` 를
  // 놓치면 정중형 금지 문장이 그대로 자동 삭제된다(R2 codex HIGH).
  "하지\\s*(않|말|마)", "안\\s*(된|됨|됩|돼|되)", "못\\s*(한|합|하)", "불가", "금지", "금한", "금함",
  "삼간", "지양", "제외한", "말\\s*것", "없이\\s*진행", "덮어쓰지",
  "허용되지\\s*않", "허용하지\\s*않", "권장하지\\s*않", "지원하지\\s*않", "쓰지\\s*(않|말)",
  "두지\\s*(않|말)", "만들지\\s*(않|말)", "바꾸지\\s*(않|말)", "건드리지\\s*(않|말)",
  "지우지\\s*(않|말)", "섞지\\s*(않|말)", "넘기지\\s*(않|말)", "의존하지\\s*않",
  // 한국어 필수·강조
  "반드시", "절대", "필수", "의무", "무조건", "항상", "먼저", "만\\s*한", "어야\\s*한",
  "어야\\s*합", "해야", "지켜", "보장한", "고정한",
  // 영어 부정·금지
  "must\\s+not", "mustn't", "shall\\s+not", "should\\s+not", "shouldn't", "cannot", "can't",
  "do\\s+not", "don't", "does\\s+not", "never", "no\\s+longer", "forbidden", "prohibited",
  "disallow", "refuse", "reject", "avoid", "deny",
  // 영어 필수
  "must\\b", "required", "mandatory", "always", "only\\s+if", "ensure\\s+that",
].join("|"), "i");

// behavior 보존 대상 차원 — **`Failure modes` 를 빠뜨리면 금지·제약 문장이 방어선을 우회한다**
// (계획서 §B4 경고·6차원 중 안전 직결).
export const PRESERVED_DIMENSIONS = ["Evidence", "Decision", "Recovery", "Failure modes"] as const;

// 문장 정규화 — 비교는 결정적이어야 한다(LLM 없음).
function norm(s: string): string {
  return s.toLowerCase().replace(/[`*_>#~\[\]()]/g, " ").replace(/\s+/g, " ").trim();
}
// 대응 판정 — **길이 차에 강건한 overlap 계수**를 쓴다(R1 agy HIGH).
// 자카드는 `"Do not skip"` vs `"You must not skip this phase"` 처럼 길이가 다르면 2/7=0.28 로
// 임계 미달이 돼 **핵심 의미가 같은데 "대응 없음"** 이 된다 — 계획서가 가장 위험하다고 한
// false negative 다. overlap = |A∩B| / min(|A|,|B|) 는 짧은 쪽이 긴 쪽에 포함되면 1.0 이다.
// **1글자 토큰을 버리지 않는다** — "안"·"못"·"꼭" 같은 한국어 핵심 제약어가 사라진다.
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length > 0));
}
export function overlap(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}
export const CORRESPOND_THRESHOLD = 0.5;
function correspond(a: string, b: string): boolean { return overlap(a, b) >= CORRESPOND_THRESHOLD; }

export function deletionGuard(inp: GuardInput): GuardVerdict {
  const line = inp.line.trim();
  if (!line) return { autoApply: false, reason: "빈 줄 — 판정 대상이 아니다", layer: "uncertain" };

  // ── 1층: 결정적 가드(기존·불변) ──────────────────────────────────────
  // 필수 섹션 안의 문장은 자동 삭제하지 않는다. 접촉 시 자동 거부는 불변이다.
  const req = inp.kind === "agent" ? REQUIRED_SECTIONS.agent : REQUIRED_SECTIONS.skill;
  // 대소문자를 정규화해 비교한다 — `## failure modes` 처럼 소문자로 적힌 섹션이 매칭되지 않으면
  // 계획서가 가장 경계한 `Failure modes` 누락이 그대로 발생한다(R1 agy HIGH).
  const headLc = inp.sectionHeading.toLowerCase();
  const hitSec = req.find((s) => headLc.includes(s.toLowerCase()));
  if (hitSec) return { autoApply: false, reason: `필수 섹션 '${hitSec}' 내부 — 완전성 가드(자동 거부 불변)`, layer: "deterministic" };
  if (CONSTRAINT.test(line)) return { autoApply: false, reason: "핵심 제약(금지·필수) 문장 — over-pruning 차단", layer: "deterministic" };

  // ── 2층: behavior 보존 가드(AND 추가) ────────────────────────────────
  const bodies = inp.behaviorBodies;
  if (!bodies || bodies.size === 0) {
    // **BEHAVIOR 미포괄 = 불확실 = 자동 적용 불가.** "대응 없음"으로 읽으면 안 된다 —
    // 그게 계획서가 경고한 false negative 다.
    return { autoApply: false, reason: "참조 BEHAVIOR 없음(미포괄) — 대응 여부를 판정할 수 없다", layer: "uncertain" };
  }
  for (const [name, body] of bodies) {
    for (const sec of splitSections(body)) {
      const secLc = sec.heading.toLowerCase();
      const dim = PRESERVED_DIMENSIONS.find((d) => secLc.includes(d.toLowerCase()));
      if (!dim) continue;
      // ⚠ **`ls.indexOf(sec.heading)` 을 쓰지 않는다**(R1 agy HIGH): heading 뒤 공백·CRLF·중복
      // heading 이면 `-1` 이 나와 `seg` 가 빈 배열이 되고 **그 차원 검사가 조용히 생략**된다.
      // `splitSections` 가 이미 섹션 경계를 알고 있으므로 그 결과를 그대로 쓴다.
      for (const cand of sec.lines) {
        if (!cand.trim()) continue;
        if (correspond(line, cand)) {
          return { autoApply: false, reason: `BEHAVIOR '${name}' 의 ${dim} 에 대응 — 보존`, layer: "behavior" };
        }
      }
    }
  }
  // 대응을 못 찾았다. **이것은 "대응 없음"이 아니라 "찾지 못했다"이다** —
  // 토큰 유사도는 의미 판정이 아니다. 그래서 여기서 끝내지 않고 **게이트 2 를 AND** 로 요구한다.
  const g = inp.dynamicGate;
  if (!g) return { autoApply: false, reason: "동적 테스트(게이트 2) 결과 없음 — 판정기 부재로 자동 적용 불가", layer: "uncertain" };
  if (!g.triggerEvalPassed) return { autoApply: false, reason: "동적 테스트 실패 — 트리거 eval 미통과", layer: "uncertain" };
  if (!g.holdoutNoRegression) return { autoApply: false, reason: "outcome holdout 에서 저하 관측 — 자동 적용 불가", layer: "uncertain" };
  return { autoApply: true, reason: "결정적 가드 통과 · 보존 차원 대응 없음 · 동적 테스트 통과", layer: "allow" };
}
