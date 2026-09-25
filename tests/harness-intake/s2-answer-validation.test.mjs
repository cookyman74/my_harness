// S2 T6 — `answer` 검증표(참조 문서 6절)의 행마다 별 테스트(결함 하나씩) + 판정 순서(명세 §2-4) + CLI 옵션 규칙(명세 §2-1).
// 모든 결함 테스트는 **대조군**(같은 입력에서 결함만 뺀 것)이 rc=0 인 것을 먼저 확인한다 — rc 가 그 결함 때문임을 보장하고,
// 미구현(rc=2 not implemented)이 결함 판정으로 오인되지 않게 한다. 실패한 answer 는 프로파일을 남기지 않는다(명세 질문 Q9).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, FULL, NOW1, profPath } from './s2-helpers.mjs';

after(cleanup);

const BASE = ['--orchestrator', 'orch1', '--now', NOW1];
const S = (s, more = []) => () => [...BASE, '--set', s, ...more];
const FILE = (content, more = []) => (fx) => { const f = path.join(fx.tmp, 'answers.txt'); fs.writeFileSync(f, content); return [...BASE, '--from-file', f, ...more]; };
const ENV = (v) => () => ({ extra: { HARNESS_INTAKE_ANSWERS: v } });

/** 대조군 rc=0 → 결함 입력 rc 단정 → 프로파일 미기록. */
function pair({ ctrl, bad, rc, fixture = 'repo-like', ctrlOpts = () => undefined, badOpts = () => undefined }) {
  const c = s2setup(fixture);
  ok(answer(c, ctrl(c), ctrlOpts(c)), '대조군');
  const b = s2setup(fixture);
  rcIs(answer(b, bad(b), badOpts(b)), rc, '결함');
  assert.ok(!fs.existsSync(profPath(b)), '실패한 answer 가 프로파일을 썼다');
  return b;
}
const rep = (from, to) => FULL.replace(from, to);

// ───── 6절 표: rc=2 행 ─────
test('[6절] 모르는 항목 키 → rc=2', () => pair({ ctrl: S(FULL), bad: S(FULL + ';bogus=x'), rc: 2 }));
test('[6절] 모르는 선택지 키 → rc=2', () => pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=faster')), rc: 2 }));
test('[6절] 이번 스캔에서 노출되지 않은 선택지 키(repo-like ② db-migration) → rc=2', () =>
  pair({ ctrl: S(FULL), bad: S(rep('irreversible=release-publish', 'irreversible=release-publish,db-migration')), rc: 2 }));
test('[6절] 미노출 선택지 키(empty ① tests-pass — tests 신호 없음) → rc=2', () => {
  const E = 'completion=artifacts-present;irreversible=unknown;cost=error-worse;approval=before:unknown,ladder;assets=reuse;egress=allow-listed';
  pair({ fixture: 'empty', ctrl: S(E), bad: S(E.replace('completion=artifacts-present', 'completion=tests-pass')), rc: 2 });
});
test('[6절] 키는 정규화하지 않는다 — 대문자·유니코드 하이픈 변형 → 모르는 키 rc=2', () => {
  pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=Error-worse')), rc: 2 });
  pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=error‐worse')), rc: 2 });
});
test('[6절] 숫자만인 토큰(위치 번호) → rc=2', () => {
  pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=1')), rc: 2 });
  pair({ ctrl: S(FULL), bad: S(rep('completion=tests-pass,ci-green', 'completion=tests-pass,2')), rc: 2 });
});
test('[6절] 같은 항목 두 번(한 입력 안 · 같은 값이어도) → rc=2', () => pair({ ctrl: S(FULL), bad: S(FULL + ';cost=error-worse'), rc: 2 }));
test('[6절] 같은 항목 두 번(--set 을 나눠서) → rc=2', () =>
  pair({ ctrl: S(FULL), bad: () => [...BASE, '--set', FULL, '--set', 'cost=error-worse'], rc: 2 }));
test('[6절] 한 항목 안 같은 토큰 두 번 → rc=2', () =>
  pair({ ctrl: S(FULL), bad: S(rep('completion=tests-pass,ci-green', 'completion=tests-pass,tests-pass,ci-green')), rc: 2 }));
test('[6절] 빈 토큰(a,,b) → rc=2', () => pair({ ctrl: S(FULL), bad: S(rep('completion=tests-pass,ci-green', 'completion=tests-pass,,ci-green')), rc: 2 }));
test('[6절] 빈 값(cost=) → rc=2', () => pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=')), rc: 2 }));
test('[6절] = 없는 조각 → rc=2', () => pair({ ctrl: S(FULL), bad: S(FULL + ';garbage'), rc: 2 }));
test('[6절] 빠진 항목 + --defaults 없음 → rc=2 (대조: --defaults 있으면 rc=0)', () => {
  const partial = rep(';assets=reuse', '');
  pair({ ctrl: S(partial, ['--defaults']), bad: S(partial), rc: 2 });
});
test('[6절] --set + --from-env → rc=2', () =>
  pair({ ctrl: () => [...BASE, '--from-env'], bad: () => [...BASE, '--set', FULL, '--from-env'], rc: 2, ctrlOpts: ENV(FULL), badOpts: ENV(FULL) }));
test('[6절] --set + --from-file → rc=2', () =>
  pair({ ctrl: FILE(FULL), bad: FILE(FULL, ['--set', FULL]), rc: 2 }));
test('[6절] --from-env + --from-file → rc=2', () =>
  pair({ ctrl: FILE(FULL), bad: FILE(FULL, ['--from-env']), rc: 2, badOpts: ENV(FULL) }));
test('[6절] --from-env 인데 HARNESS_INTAKE_ANSWERS 없음 → rc=2', () =>
  pair({ ctrl: () => [...BASE, '--from-env'], bad: () => [...BASE, '--from-env'], rc: 2, ctrlOpts: ENV(FULL) }));
test('[6절] --from-file 없는 파일 → rc=2', () =>
  pair({ ctrl: FILE(FULL), bad: (fx) => [...BASE, '--from-file', path.join(fx.tmp, 'nope.txt')], rc: 2 }));
test('[6절] --from-file 여러 줄 → rc=2', () =>
  pair({ ctrl: FILE(FULL), bad: FILE(FULL.replace(';cost=', '\ncost=')), rc: 2 }));
test('[6절] --from-file 끝 개행 2개(1개만 제거 → 여러 줄) → rc=2 (명세 질문 Q7)', () =>
  pair({ ctrl: FILE(FULL + '\n'), bad: FILE(FULL + '\n\n'), rc: 2 }));
test('[6절] --from-file 내용이 HARNESS_INTAKE_ANSWERS= 로 시작 → rc=2', () =>
  pair({ ctrl: FILE(FULL), bad: FILE('HARNESS_INTAKE_ANSWERS=' + FULL), rc: 2 }));
test('[6절] --orchestrator 없음 → rc=2', () =>
  pair({ ctrl: S(FULL), bad: () => ['--now', NOW1, '--set', FULL], rc: 2 }));
test('[6절] --orchestrator 이름이 ^[a-z0-9][a-z0-9-]{0,63}$ 아님 → rc=2 (경계: 64자 rc=0)', () => {
  const c = s2setup();
  ok(answer(c, ['--orchestrator', 'a'.repeat(64), '--now', NOW1, '--set', FULL]), '대조군 64자');
  ok(answer(c, ['--orchestrator', '0', '--now', NOW1, '--set', FULL]), '대조군 숫자 한 글자');
  for (const bad of ['Orch1', '-orch', 'orch_1', '../evil', 'a'.repeat(65), '', 'orch1/x', 'orch.1']) {
    const b = s2setup();
    rcIs(answer(b, ['--orchestrator', bad, '--now', NOW1, '--set', FULL]), 2, `이름 ${JSON.stringify(bad)}`);
    assert.ok(!fs.existsSync(path.join(b.root, '.claude', 'evil')), '경로 탈출 디렉토리가 생겼다');
    assert.ok(!fs.existsSync(path.join(b.root, '.claude', 'skills')) || fs.readdirSync(path.join(b.root, '.claude', 'skills')).every((d) => d === 'lint-skill'),
      `실패했는데 스킬 디렉토리가 생겼다: ${bad}`);
  }
});

// ───── 6절 표: rc=1 행 ─────
test('[6절] none + 다른 키 → rc=1', () =>
  pair({ ctrl: S('completion=tests-pass;irreversible=none;cost=error-worse;approval=ladder;assets=reuse;egress=allow-listed'),
    bad: S('completion=tests-pass;irreversible=none,unknown;cost=error-worse;approval=ladder;assets=reuse;egress=allow-listed'), rc: 1 }));
test('[6절] none + other:<문장> → rc=1', () =>
  pair({ ctrl: S('completion=tests-pass;irreversible=none;cost=error-worse;approval=ladder;assets=reuse;egress=allow-listed'),
    bad: S('completion=tests-pass;irreversible=none,other:DNS 변경;cost=error-worse;approval=ladder;assets=reuse;egress=allow-listed'), rc: 1 }));
test('[6절] 단일 문항 cost 에 토큰 둘 → rc=1', () => pair({ ctrl: S(FULL), bad: S(rep('cost=error-worse', 'cost=error-worse,balanced')), rc: 1 }));
test('[6절] 단일 문항 assets 에 토큰 둘 → rc=1', () => pair({ ctrl: S(FULL), bad: S(rep('assets=reuse', 'assets=reuse,ignore')), rc: 1 }));
test('[6절] ④ before:<키> 가 ② 답에 없는 키(unknown — 노출은 됨) → rc=1', () =>
  pair({ ctrl: S(FULL), bad: S(rep('approval=before:release-publish,ladder', 'approval=before:unknown,ladder')), rc: 1 }));

// ───── 판정 순서(명세 §2-4: 인자 → 읽기 → 문법 → 키 → 의미 → 빠진 항목) ─────
test('[순서] 문법 결함(빈 토큰 rc=2)이 의미 결함(단일 복수 rc=1)보다 먼저', () => {
  const fx = s2setup();
  rcIs(answer(fx, S(rep('cost=error-worse', 'cost=error-worse,balanced').replace('ci-green', ',ci-green'))()), 2);
});
test('[순서] 키 결함(모르는 키 rc=2)이 의미 결함(단일 복수 rc=1)보다 먼저', () => {
  rcIs(answer(s2setup(), S(rep('cost=error-worse', 'cost=error-worse,bogus'))()), 2);
});
test('[순서] 의미 결함(none 배타 rc=1)이 빠진 항목(--defaults 없음 rc=2)보다 먼저', () => {
  rcIs(answer(s2setup(), S('irreversible=none,unknown')()), 1);
});
test('[순서] 인자 결함(--orchestrator 없음 rc=2)이 의미 결함(rc=1)보다 먼저', () => {
  rcIs(answer(s2setup(), ['--now', NOW1, '--set', rep('cost=error-worse', 'cost=error-worse,balanced')]), 2);
});

// ───── CLI 공통(명세 §2-1) ─────
test('--now 가 날짜로 파싱되지 않음 → rc=2', () => pair({ ctrl: S(FULL), bad: () => ['--orchestrator', 'orch1', '--now', 'not-a-date', '--set', FULL], rc: 2 }));
test('반복 불가 옵션 두 번(--orchestrator) → rc=2', () =>
  pair({ ctrl: S(FULL), bad: () => ['--orchestrator', 'orch1', '--orchestrator', 'orch1', '--now', NOW1, '--set', FULL], rc: 2 }));
test('반복 불가 옵션 두 번(--now) → rc=2', () =>
  pair({ ctrl: S(FULL), bad: () => ['--orchestrator', 'orch1', '--now', NOW1, '--now', NOW1, '--set', FULL], rc: 2 }));
test('answer --mode 가 new|extend 밖 → rc=2', () => pair({ ctrl: S(FULL, ['--mode', 'new']), bad: S(FULL, ['--mode', 'maintain']), rc: 2 }));
test('--why 같은 항목 두 번 → rc=2(항목당 한 번)', () =>
  pair({ ctrl: S(FULL, ['--why', 'cost=근거']), bad: S(FULL, ['--why', 'cost=근거', '--why', 'cost=또']), rc: 2 }));
test('--recommended 같은 항목 두 번 → rc=2', () =>
  pair({ ctrl: S(FULL, ['--recommended', 'cost=error-worse']), bad: S(FULL, ['--recommended', 'cost=error-worse', '--recommended', 'cost=balanced']), rc: 2 }));
test('--recommended 도 같은 검증 — 모르는 키 rc=2', () =>
  pair({ ctrl: S(FULL, ['--recommended', 'cost=balanced']), bad: S(FULL, ['--recommended', 'cost=bogus']), rc: 2 }));
test('--recommended 도 같은 검증 — 단일 문항 복수 rc=1', () =>
  pair({ ctrl: S(FULL, ['--recommended', 'cost=balanced']), bad: S(FULL, ['--recommended', 'cost=balanced,error-worse']), rc: 1 }));
