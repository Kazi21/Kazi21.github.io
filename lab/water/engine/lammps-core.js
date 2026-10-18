/* Live Water Lab — LAMMPS engine core (shared by the browser worker and the Node test harness).
   Wraps the LAMMPS C library interface exported by lammps-water.wasm (LAMMPS stable_22Jul2025_update4,
   single-threaded, MOLECULE + KSPACE + RIGID). All physics is computed by LAMMPS. */
(function (root) {
  'use strict';

  class LammpsCore {
    constructor(Module) {
      this.M = Module;
      const M = Module;
      this.c = {
        open: M.cwrap('lammps_open_no_mpi', 'number', ['number', 'number', 'number']),
        close: M.cwrap('lammps_close', null, ['number']),
        command: M.cwrap('lammps_command', 'number', ['number', 'string']),
        commands: M.cwrap('lammps_commands_string', null, ['number', 'string']),
        natoms: M.cwrap('lammps_get_natoms', 'number', ['number']),
        thermo: M.cwrap('lammps_get_thermo', 'number', ['number', 'string']),
        hasError: M.cwrap('lammps_has_error', 'number', ['number']),
        lastError: M.cwrap('lammps_get_last_error_message', 'number', ['number', 'number', 'number']),
        version: M.cwrap('lammps_version', 'number', ['number']),
        hasPackage: M.cwrap('lammps_config_has_package', 'number', ['string']),
        gather: M.cwrap('wl_gather_xvf', 'number', ['number', 'number', 'number', 'number']),
        box: M.cwrap('wl_box', null, ['number', 'number']),
        cscalar: M.cwrap('wl_compute_scalar', 'number', ['number', 'string']),
        cvector: M.cwrap('wl_compute_vector', 'number', ['number', 'string', 'number']),
        variable: M.cwrap('wl_variable', 'number', ['number', 'string']),
        fscalar: M.cwrap('wl_fix_scalar', 'number', ['number', 'string']),
        fvector: M.cwrap('wl_fix_vector', 'number', ['number', 'string', 'number']),
        step: M.cwrap('wl_step', 'number', ['number']),
      };
      this.handle = 0;
      this.buf = { n: 0, x: 0, v: 0, f: 0, box: M._malloc(6 * 8) };
    }

    open(args = ['lmp', '-log', 'none', '-screen', 'none', '-nocite']) {
      const M = this.M;
      const ptrs = args.map((a) => { const n = M.lengthBytesUTF8(a) + 1; const p = M._malloc(n); M.stringToUTF8(a, p, n); return p; });
      const argv = M._malloc(4 * ptrs.length);
      ptrs.forEach((p, i) => M.setValue(argv + 4 * i, p, 'i32'));
      this.handle = this.c.open(args.length, argv, 0);
      ptrs.forEach((p) => M._free(p)); M._free(argv);
      if (!this.handle) throw new Error('LAMMPS failed to start');
      return this;
    }

    checkError() {
      if (this.c.hasError(this.handle)) {
        const n = 2048, p = this.M._malloc(n);
        this.c.lastError(this.handle, p, n);
        const msg = this.M.UTF8ToString(p); this.M._free(p);
        const err = new Error(msg.trim() || 'LAMMPS error'); err.lammps = true; throw err;
      }
    }

    commands(text) { this.c.commands(this.handle, text); this.checkError(); }
    command(line) { this.c.command(this.handle, line); this.checkError(); }
    thermo(key) { return this.c.thermo(this.handle, key); }
    computeScalar(id) { return this.c.cscalar(this.handle, id); }
    computeVector(id, i) { return this.c.cvector(this.handle, id, i); }
    variable(name) { return this.c.variable(this.handle, name); }
    fixScalar(id) { return this.c.fscalar(this.handle, id); }
    fixVector(id, i) { return this.c.fvector(this.handle, id, i); }
    step() { return this.c.step(this.handle); }
    version() { return this.c.version(this.handle); }
    hasPackage(name) { return !!this.c.hasPackage(name); }
    writeFile(path, text) { this.M.FS.writeFile(path, text); }
    readFile(path) { return this.M.FS.readFile(path, { encoding: 'utf8' }); }

    box() {
      this.c.box(this.handle, this.buf.box);
      const b = new Float64Array(this.M.HEAPF64.buffer, this.buf.box, 6);
      return { lo: [b[0], b[1], b[2]], hi: [b[3], b[4], b[5]] };
    }

    /* Copies of unwrapped positions, velocities and forces (Å, Å/fs, kcal/mol/Å), ordered by atom ID. */
    gather(withV = true, withF = true) {
      const M = this.M, n = this.c.natoms(this.handle);
      if (n !== this.buf.n) {
        ['x', 'v', 'f'].forEach((k) => { if (this.buf[k]) M._free(this.buf[k]); this.buf[k] = M._malloc(3 * n * 8); });
        this.buf.n = n;
      }
      this.c.gather(this.handle, this.buf.x, withV ? this.buf.v : 0, withF ? this.buf.f : 0);
      this.checkError();
      const view = (p) => new Float64Array(M.HEAPF64.buffer, p, 3 * n).slice();
      return { n, x: view(this.buf.x), v: withV ? view(this.buf.v) : null, f: withF ? view(this.buf.f) : null };
    }

    close() {
      if (this.handle) { this.c.close(this.handle); this.handle = 0; }
      ['x', 'v', 'f', 'box'].forEach((k) => { if (this.buf[k]) this.M._free(this.buf[k]); this.buf[k] = 0; });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { LammpsCore };
  else root.LammpsCore = LammpsCore;
})(typeof self !== 'undefined' ? self : this);
