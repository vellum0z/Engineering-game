/*
 * Answer-key tests: every task input and manual deliverable must declare a
 * canonical `answer` string, and that answer must pass its own checker spec.
 * Optional `wrong: [{ input, kind }]` samples must fail with the stated
 * error kind, so the feedback for common mistakes is verified too.
 */
'use strict';
const { suite, test, ok, eq } = require('./harness');
const SE = globalThis.SE;

SE.content.allChapters().forEach(ch => {
  suite('answer keys · ' + ch.id, () => {
    SE.content.allAnswerSpecs(ch.id).forEach(({ where, input }) => {
      const spec = typeof input.spec === 'function' ? input.spec({ values: {} }) : input.spec;
      test(where + ' has a canonical answer', () => ok(typeof input.answer === 'string' && input.answer.length > 0, 'missing answer'));
      test(where + ' canonical answer passes', () => {
        const r = SE.checker.check(input.answer, spec);
        ok(r.correct, `"${input.answer}" rejected: ${r.errors.map(e => e.kind + ': ' + e.msg).join(' | ')}`);
      });
      (input.wrong || []).forEach(w => {
        test(where + ' rejects "' + w.input + '" as ' + w.kind, () => {
          const r = SE.checker.check(w.input, spec);
          ok(!r.correct, 'wrong sample was accepted');
          if (w.kind) eq(r.kind, w.kind, 'error kind');
        });
      });
    });
  });
});
