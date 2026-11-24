/*
 * Breakage: parts fail when they carry more than they are rated for.
 *
 *   P.breakage.check(world, dt)
 * runs once per step, after the solver. The simulation decides when a cable
 * snaps, a pin shears or a beam cracks, not a script.
 *
 * Joints. Every joint records lastForce / peakForce (N) and, if it has
 * torque(), lastTorque / peakTorque (N·m). A joint past breakForce fails
 * with reason 'force', past breakTorque with 'torque'.
 *
 * Beam welds (j.part.kind === 'beam', see structures.js) are checked against
 * their section instead: |M| > σ_y·S -> 'moment', axial tension > σ_y·A ->
 * 'tension', axial compression or shear past its limit -> 'force'.
 *
 * Truss members (structures with kind 'truss') are checked on their signed
 * axial force: tension > σ_y·A -> 'tension'; compression past
 * min(σ_y·A, π²EI/L²) -> 'buckling' when Euler's load is the smaller one,
 * otherwise 'compression' (the bar crushes). A failed member's two pins are
 * removed, so it falls out of the truss.
 *
 * Every failure removes the joint(s) and emits
 *   'break' { joint, force, torque, reason, part }
 * where part is { structure, index, kind } for structure parts and null for
 * plain joints. Truss breaks also carry `joints` (both pins) and `member`.
 *
 * Hysteresis: world.cfg.breakHysteresis = k (default 1) means a limit must
 * be exceeded on k consecutive steps before the part fails. A rigid solver
 * can produce a one-frame force spike on impact that a real part, which
 * flexes for a few milliseconds, would survive; k = 2 or 3 filters that
 * without hiding a sustained overload (k steps at 60 Hz is k × 17 ms).
 * The counter (j.overSteps / member.overSteps) resets as soon as the load
 * drops back under the limit.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;

  function hysteresis(world) {
    var k = world.cfg && world.cfg.breakHysteresis;
    return k > 1 ? Math.floor(k) : 1;
  }

  // Which limit, if any, a joint is past right now.
  function jointVerdict(j, F, T) {
    if (j.limits && j.loads) {
      var L = j.limits, q = j.loads();
      if (Math.abs(q.moment) > L.moment && j.type === 'weld') return 'moment';
      if (q.axial > L.axial) return 'tension';
      if (-q.axial > L.axial || Math.abs(q.shear) > L.shear) return 'force';
    }
    if (F > j.breakForce) return 'force';
    if (j.breakTorque != null && Math.abs(T) > j.breakTorque) return 'torque';
    return null;
  }

  function memberVerdict(m, T) {
    if (T > m.limits.tension) return 'tension';
    if (-T > m.limits.compression) return m.limits.buckling < m.limits.crushing ? 'buckling' : 'compression';
    return null;
  }

  // Count consecutive over-limit steps on `obj`; true when it should fail.
  function over(obj, why, k) {
    if (!why) { obj.overSteps = 0; return false; }
    obj.overSteps = (obj.overSteps || 0) + 1;
    return obj.overSteps >= k;
  }

  function check(world) {
    var k = hysteresis(world);
    world.joints.slice().forEach(function (j) {
      if (j.broken) return;
      var F = j.force();
      j.lastForce = F;
      j.peakForce = Math.max(j.peakForce || 0, F);
      var T = j.torque ? j.torque() : 0;
      j.lastTorque = Math.abs(T);
      j.peakTorque = Math.max(j.peakTorque || 0, Math.abs(T));
      var why = jointVerdict(j, F, T);
      if (!over(j, why, k)) return;
      j.broken = true;
      world.removeJoint(j);
      world.emit('break', { joint: j, force: F, torque: Math.abs(T), reason: why, part: j.part || null });
    });

    (world.structures || []).forEach(function (s) {
      if (s.kind !== 'truss') return;
      s.members.forEach(function (m, i) {
        if (m.broken) return;
        var T = s.memberForce(i);
        m.lastForce = T;
        m.peakForce = Math.max(m.peakForce || 0, Math.abs(T));
        var why = memberVerdict(m, T);
        if (!over(m, why, k)) return;
        s.release(i);
        world.emit('break', { joint: m.pins[0], joints: m.pins, member: m, force: Math.abs(T), torque: 0,
          reason: why, part: { structure: s, index: i, kind: 'member' } });
      });
    });
  }

  P.breakage = { check: check };
})(globalThis.SE);
