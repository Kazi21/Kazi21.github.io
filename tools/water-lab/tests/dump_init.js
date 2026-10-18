// Prints the page's initialisation commands as JSON: node dump_init.js <N> <npt|nvt> [ljScale]
'use strict';
const H = require('./harness.js');
const N = parseInt(process.argv[2] || '216', 10), ens = process.argv[3] || 'nvt', s = parseFloat(process.argv[4] || '1');
process.stdout.write(JSON.stringify({ N, ensemble: ens, commands: H.W.initCommands({ dataFile: 'start.data', T: 298.15, Pbar: 1, ljScale: s, ensemble: ens }) }));
