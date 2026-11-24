/*
 * Materials: the physical data parts are made of, and the ratings that say
 * when a part made of them fails.
 *
 * Every material has
 *   label        short display name
 *   density      kg/m^3 (the 2D engine treats each body as a slab 1 m deep
 *                unless a part sets its own mass or thickness, see body.js)
 *   friction     Coulomb coefficient the contact solver uses today
 *   muS, muK     static and kinetic coefficients (dry, against a similar
 *                surface); `friction` stays as the fallback for code that
 *                only knows one number
 *   restitution  0 = dead stop, 1 = perfectly bouncy
 *   E            Young's modulus, Pa
 *   yield        yield strength, Pa (onset of permanent bending/stretching)
 *   ultimate     ultimate tensile strength, Pa (where it actually tears)
 *   color        a drawing hint for the renderer
 * Rope and chain materials also carry `ropeK`, see rating.cable below.
 *
 * Values are typical handbook figures (structural steel A36, softwood
 * timber along the grain, normal concrete in tension, etc.) rounded to the
 * precision a game needs. Mixing rules follow common engine practice:
 * friction is the geometric mean of the two surfaces, restitution the larger.
 *
 *   P.material(name | object)        -> material (objects pass straight through)
 *   P.rating.cable(mat, d, SF)       breaking load of a rope/cable/chain of diameter d (N)
 *   P.rating.rod(mat, A, SF)         axial load that yields a solid bar of area A (N)
 *   P.rating.weld(mat, throat, L, SF) shear strength of a fillet weld (N)
 *   P.rating.pin(mat, d, opts|SF)    shear strength of a pin, single or double shear (N)
 *   P.rating.moment(mat, S, SF)      yield moment σ_y·S of a section modulus S (N·m)
 *   P.rating.buckling(mat, I, L, K)  Euler load π²EI/(KL)² of a strut (N)
 * Every rating divides by the safety factor SF (default 1, i.e. the load at
 * which the part fails, which is what the simulation needs).
 */
(function (SE) {
  'use strict';

  function mat(o) { o.muS = o.muS != null ? o.muS : o.friction; o.muK = o.muK != null ? o.muK : o.friction; return o; }

  var MATERIALS = {
    steel:    mat({ name: 'steel', label: 'Steel', density: 7850, friction: 0.55, muS: 0.74, muK: 0.57, restitution: 0.10,
                    E: 200e9, yield: 250e6, ultimate: 400e6, color: '#8a939c' }),
    timber:   mat({ name: 'timber', label: 'Timber', density: 550, friction: 0.45, muS: 0.50, muK: 0.40, restitution: 0.15,
                    E: 11e9, yield: 40e6, ultimate: 50e6, color: '#a87a4a' }),
    concrete: mat({ name: 'concrete', label: 'Concrete', density: 2400, friction: 0.70, muS: 0.70, muK: 0.60, restitution: 0.05,
                    E: 25e9, yield: 3e6, ultimate: 3.5e6, compressive: 30e6, color: '#a5a29b' }),
    rubber:   mat({ name: 'rubber', label: 'Rubber', density: 1100, friction: 0.90, muS: 1.0, muK: 0.80, restitution: 0.60,
                    E: 0.05e9, yield: 15e6, ultimate: 20e6, color: '#2f2f33' }),
    ice:      mat({ name: 'ice', label: 'Ice', density: 917, friction: 0.03, muS: 0.10, muK: 0.03, restitution: 0.05,
                    E: 9e9, yield: 1e6, ultimate: 1.5e6, color: '#cfe8f5' }),
    rope:     mat({ name: 'rope', label: 'Rope', density: 1140, friction: 0.50, restitution: 0.00,
                    E: 2e9, yield: 60e6, ultimate: 80e6, ropeK: Math.PI / 4, color: '#c9b27c' }),
    aluminium:mat({ name: 'aluminium', label: 'Aluminium', density: 2700, friction: 0.45, muS: 0.61, muK: 0.47, restitution: 0.10,
                    E: 69e9, yield: 95e6, ultimate: 130e6, color: '#c3c8cc' }),
    cargo:    mat({ name: 'cargo', label: 'Cargo', density: 400, friction: 0.50, restitution: 0.05,
                    E: 1e9, yield: 5e6, ultimate: 6e6, color: '#7d6a4f' }),
    frictionless: mat({ name: 'frictionless', label: 'Frictionless', density: 1000, friction: 0, restitution: 0,
                    E: 1e9, yield: 1e9, ultimate: 1e9, color: '#9fb8d0' }),

    // Ropes and chains. Their breaking force is F = ropeK · d² · ultimate
    // (d = nominal diameter):
    //  - Steel wire rope follows EN 12385-4, F_min = K·d²·R_r, with rope
    //    grade R_r = 1770 MPa and K = 0.356 for 6x19 with a steel core. A
    //    10 mm rope comes out at 63 kN, matching makers' tables (≈ 60–68 kN).
    //  - Fibre ropes use the nominal circle (K = π/4) and an effective
    //    strength back-calculated from Cordage Institute minimum breaking
    //    strengths: 1/2" manila 2,380 lbf (10.6 kN) -> ≈ 80 MPa, 1/2" nylon
    //    3-strand 6,080 lbf (27 kN) -> ≈ 210 MPa.
    //  - Chain grade 80 (EN 818-2): breaking force = 2 legs × (πd²/4) × 800 MPa,
    //    so K = π/2; 10 mm chain breaks at 126 kN (WLL 3.15 t at a 4:1 factor).
    wireRope: mat({ name: 'wireRope', label: 'Steel wire rope', density: 7850 * 0.453, friction: 0.30, restitution: 0.02,
                    E: 100e9, yield: 1500e6, ultimate: 1770e6, ropeK: 0.356, color: '#6d747a' }),
    manila:   mat({ name: 'manila', label: 'Manila rope', density: 1500 * 0.8, friction: 0.50, restitution: 0.00,
                    E: 1.5e9, yield: 60e6, ultimate: 80e6, ropeK: Math.PI / 4, color: '#c9b27c' }),
    nylon:    mat({ name: 'nylon', label: 'Nylon rope', density: 1140 * 0.8, friction: 0.35, restitution: 0.05,
                    E: 1.0e9, yield: 150e6, ultimate: 210e6, ropeK: Math.PI / 4, color: '#e6e1d3' }),
    chain80:  mat({ name: 'chain80', label: 'Chain (grade 80)', density: 7850 * 0.85, friction: 0.40, restitution: 0.05,
                    E: 200e9, yield: 640e6, ultimate: 800e6, ropeK: Math.PI / 2, color: '#5a6066' })
  };

  function material(name) {
    if (typeof name === 'object' && name) return name;
    var m = MATERIALS[name || 'steel'];
    if (!m) throw new Error('unknown material "' + name + '"');
    return m;
  }

  function mixFriction(a, b) { return Math.sqrt(a * b); }
  function mixRestitution(a, b) { return Math.max(a, b); }

  function sf(x) { return x > 0 ? x : 1; }

  var rating = {
    // Breaking load of a rope, cable or chain of nominal diameter d (m).
    // Materials without ropeK are treated as a solid round bar at ultimate.
    cable: function (m, d, safety) {
      m = material(m);
      var K = m.ropeK != null ? m.ropeK : Math.PI / 4;
      return K * d * d * m.ultimate / sf(safety);
    },
    // A solid rod or tie of cross-section area A (m²) yields at σ_y·A.
    rod: function (m, A, safety) { return material(m).yield * A / sf(safety); },
    // Fillet weld: nominal shear strength 0.6·σ_u on the throat area
    // (throat = 0.707 × leg size), as in AWS D1.1 / AISC J2.
    weld: function (m, throat, length, safety) {
      return 0.6 * material(m).ultimate * throat * length / sf(safety);
    },
    // Pin in shear: 0.6·σ_u on each shear plane (two planes in a clevis).
    // opts: { double: true } or { planes: n, safety }; a number is the safety factor.
    pin: function (m, d, opts) {
      opts = typeof opts === 'number' ? { safety: opts } : (opts || {});
      var planes = opts.planes || (opts.double ? 2 : 1);
      return planes * 0.6 * material(m).ultimate * Math.PI * d * d / 4 / sf(opts.safety);
    },
    // Bending: first yield at the outer fibre, M_y = σ_y·S with S = I/c.
    moment: function (m, S, safety) { return material(m).yield * S / sf(safety); },
    // Euler buckling of a pinned strut (K = 1) of length L.
    buckling: function (m, I, L, K) {
      var Le = (K || 1) * L;
      return Math.PI * Math.PI * material(m).E * I / (Le * Le);
    }
  };

  SE.phys = SE.phys || {};
  SE.phys.MATERIALS = MATERIALS;
  SE.phys.material = material;
  SE.phys.mixFriction = mixFriction;
  SE.phys.mixRestitution = mixRestitution;
  SE.phys.rating = rating;
})(globalThis.SE);
