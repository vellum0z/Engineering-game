/*
 * Recorder: samples gauges into time series as the world steps.
 *
 *   var rec = new SE.phys.Recorder(world, {
 *     gauges: { speed: new P.sensors.Speedometer(sled), tension: cell },
 *     every: 1                       // sample every n-th step
 *   });
 *   world.run(5);
 *   rec.series('speed')   -> { t: [...], v: [...], unit, min, max, peak, last }
 *   rec.peak('tension')   -> largest |value| seen (what a job judge checks)
 *   rec.toCSV()           -> "t,speed,tension\n0.0166...,..."
 *   rec.stop()
 *
 * It listens to the world's 'step' event and only reads gauges, so a scene
 * runs the same with or without it. Values are SI.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;

  function Recorder(world, opts) {
    opts = opts || {};
    var self = this;
    this.world = world;
    this.every = Math.max(1, Math.round(opts.every || 1));
    this.names = [];
    this.gauges = {};
    this.t = [];
    this.data = {};
    this.stats = {};
    this.count = 0;
    this.stopped = false;
    var g = opts.gauges || {};
    Object.keys(g).forEach(function (name) { self.add(name, g[name]); });
    this.listener = function () { self.onStep(); };
    world.on('step', this.listener);
  }

  // Add a gauge part-way through; earlier samples are filled with null.
  Recorder.prototype.add = function (name, gauge) {
    if (this.gauges[name]) throw new Error('recorder already has a gauge called ' + name);
    this.names.push(name);
    this.gauges[name] = typeof gauge === 'function' ? { read: gauge, unit: '' } : gauge;
    this.data[name] = this.t.map(function () { return null; });
    this.stats[name] = { min: Infinity, max: -Infinity, peak: 0, peakTime: null, last: null };
    return this;
  };

  Recorder.prototype.onStep = function () {
    if (this.stopped) return;
    this.count++;
    if ((this.count - 1) % this.every !== 0) return;
    this.sample();
  };

  Recorder.prototype.sample = function () {
    var w = this.world, self = this;
    this.t.push(w.time);
    this.names.forEach(function (name) {
      var v = self.gauges[name].read(w), s = self.stats[name];
      self.data[name].push(v);
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
      if (Math.abs(v) > s.peak) { s.peak = Math.abs(v); s.peakTime = w.time; }
      s.last = v;
    });
  };

  Recorder.prototype.series = function (name) {
    var s = this.stats[name];
    if (!s) throw new Error('no gauge called ' + name);
    return {
      t: this.t.slice(), v: this.data[name].slice(), unit: this.gauges[name].unit || '',
      min: s.min, max: s.max, peak: s.peak, peakTime: s.peakTime, last: s.last
    };
  };
  Recorder.prototype.peak = function (name) { return this.series(name).peak; };
  Recorder.prototype.min = function (name) { return this.series(name).min; };
  Recorder.prototype.max = function (name) { return this.series(name).max; };
  Recorder.prototype.length = function () { return this.t.length; };

  // CSV with a header row; the unit goes in brackets after each name.
  Recorder.prototype.toCSV = function () {
    var self = this;
    var head = ['t [s]'].concat(this.names.map(function (n) {
      var u = self.gauges[n].unit; return u ? n + ' [' + u + ']' : n;
    }));
    var rows = [head.join(',')];
    for (var i = 0; i < this.t.length; i++) {
      rows.push([this.t[i]].concat(this.names.map(function (n) {
        var v = self.data[n][i]; return v == null ? '' : v;
      })).join(','));
    }
    return rows.join('\n') + '\n';
  };

  // Stop sampling and drop the listener from the world.
  Recorder.prototype.stop = function () {
    this.stopped = true;
    var list = this.world.listeners && this.world.listeners.step;
    if (list) { var i = list.indexOf(this.listener); if (i >= 0) list.splice(i, 1); }
    return this;
  };

  Recorder.prototype.clear = function () {
    var self = this;
    this.t = []; this.count = 0;
    this.names.forEach(function (n) {
      self.data[n] = [];
      self.stats[n] = { min: Infinity, max: -Infinity, peak: 0, peakTime: null, last: null };
    });
    return this;
  };

  P.Recorder = Recorder;
})(globalThis.SE);
