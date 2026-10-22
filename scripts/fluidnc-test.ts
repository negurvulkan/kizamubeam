// Tests für FluidNC: Overrides, Statusbericht, Dateien, Konfiguration, Ausgänge, Suche. Aufruf: npm run test:fluidnc
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { estimate, gcodeFooter, Moves, newDevice, writeGCode } from '../src/gcode';
import {
  airProblem, configText, coolantPins, deleteCmd, diffConfig, digitalOutputs, directionPinPath, invertPin, listCmd, OVERRIDE, overrideSteps,
  parseConfigFile, parseEsp800, parseFileList, pinNames, restoreCmds, runCmd, safeFileName, saveCmd, setCmd,
} from '../src/fluidnc';
import { emptyStatus, parseStatus, WorkOffset } from '../src/machine';
import { checkConfig, directionFix, emptyFacts, Facts, parseFluidConfig } from '../src/setup';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const CD = `name: Swiitol E6 Pro
start:
  must_home: true
axes:
  x:
    max_travel_mm: 365.000
    homing:
      cycle: 1
    motor0:
      limit_neg_pin: NO_PIN
      stepstick:
        step_pin: i2so.1
        direction_pin: i2so.2:low
  y:
    max_travel_mm: 305.000
    homing:
      cycle: 2
    motor0:
      stepstick:
        direction_pin: i2so.5
coolant:
  flood_pin: NO_PIN
  mist_pin: gpio.2
user_outputs:
  digital0_pin: gpio.25
  digital1_pin: NO_PIN
  digital3_pin: gpio.26:low
Laser:
  speed_map: 0=0.000% 1000=100.000%
ok`.split('\n');
const conf = parseFluidConfig(CD);

test('Overrides: Schritte von 10 und 1 bis zum Ziel', () => {
  const p = OVERRIDE.power;
  assert.deepEqual(overrideSteps('power', 100, 100), [p.reset]);
  assert.deepEqual(overrideSteps('power', 100, 123), [p.plus10, p.plus10, p.plus1, p.plus1, p.plus1]);
  assert.deepEqual(overrideSteps('power', 120, 109), [p.minus10, p.minus1]);
  // Unbekannter Stand: erst auf 100 %
  assert.deepEqual(overrideSteps('feed', NaN, 90), [OVERRIDE.feed.reset, OVERRIDE.feed.minus10]);
  // Grenzen 10 … 200 %
  assert.equal(overrideSteps('feed', 100, 500).filter((b) => b === OVERRIDE.feed.plus10).length, 10);
});

test('Statusbericht: Overrides, Eingänge, Zubehör, SD-Job, Puffer', () => {
  const wco: WorkOffset = { v: [0, 0, 0], known: false };
  let st = parseStatus('<Run|MPos:1.000,2.000,0.000|Bf:15,1024|FS:1000,500|Ov:120,50,80|Pn:XP|A:SF|SD:42.5,/sd/kizamubeam.gcode>', emptyStatus(), wco);
  assert.deepEqual(st.ov, [120, 50, 80]);
  assert.equal(st.pins, 'XP');
  assert.equal(st.acc, 'SF');
  assert.deepEqual(st.sd, { pct: 42.5, file: '/sd/kizamubeam.gcode' });
  assert.deepEqual(st.bf, [15, 1024]);
  // Ov fehlt oft: bleibt; Pn, A und SD fehlen, wenn nichts aktiv ist
  st = parseStatus('<Idle|MPos:1.000,2.000,0.000|FS:0,0>', st, wco);
  assert.deepEqual(st.ov, [120, 50, 80]);
  assert.equal(st.pins, '');
  assert.equal(st.acc, '');
  assert.equal(st.sd, null);
  // Dateiname mit Komma und Doppelpunkt
  st = parseStatus('<Run|MPos:0,0,0|SD:3.0,/sd/a,b:c.nc>', st, wco);
  assert.deepEqual(st.sd, { pct: 3, file: '/sd/a,b:c.nc' });
  assert.deepEqual(pinNames('XD').length, 2);
});

test('Dateien: Liste lesen, Befehle, sichere Namen', () => {
  const files = parseFileList(['[FILE:/b.gcode|SIZE:1200]', '[DIR:/jobs]', '[FILE: a.nc|SIZE:5]', '[MSG:INFO: something]', 'ok']);
  assert.deepEqual(files, [
    { name: '/jobs', size: 0, dir: true },
    { name: '/b.gcode', size: 1200, dir: false },
    { name: 'a.nc', size: 5, dir: false },
  ]);
  assert.equal(listCmd('sd'), '$SD/List');
  assert.equal(runCmd('localfs', 'job.gcode'), '$LocalFS/Run=/job.gcode');
  assert.equal(deleteCmd('sd', '/x.gcode'), '$SD/Delete=/x.gcode');
  assert.equal(safeFileName('Schild für Jörg & Söhne.gcode'), 'Schild-fur-Jorg-Sohne.gcode');
  assert.equal(safeFileName('   '), 'kizamubeam.gcode');
});

test('Konfiguration: setzen, speichern, Dateiname, Text', () => {
  assert.equal(setCmd('axes/x/max_travel_mm', ' 360 '), '$/axes/x/max_travel_mm=360');
  assert.throws(() => setCmd('axes/x/../y', '1'));
  assert.throws(() => setCmd('axes/x/max_travel_mm', '1\n$Bye'));
  assert.equal(saveCmd('config.yaml'), '$CD=config.yaml');
  assert.equal(saveCmd(''), '$CD=config.yaml');
  assert.equal(parseConfigFile(['$Config/Filename=e6pro.yaml', 'ok']), 'e6pro.yaml');
  const text = configText(['[MSG:INFO: x]', 'name: A', 'axes:', '  x:', '    max_travel_mm: 1', 'ok']);
  assert.equal(text, 'name: A\naxes:\n  x:\n    max_travel_mm: 1\n');
  // Sicherung wieder einlesen ergibt dieselben Werte
  assert.deepEqual(parseFluidConfig(configText(CD).split('\n')), conf);
});

test('Konfiguration: Unterschiede und Wiederherstellen', () => {
  const now = { ...conf, 'axes/x/max_travel_mm': '400.000', 'extra/key': '1' };
  assert.deepEqual(diffConfig(now, conf), [{ path: 'axes/x/max_travel_mm', from: '400.000', to: '365.000' }]);
  assert.deepEqual(restoreCmds(now, conf, 'config.yaml'), ['$/axes/x/max_travel_mm=365.000', '$CD=config.yaml']);
  assert.deepEqual(restoreCmds(conf, conf, 'config.yaml'), []);
});

test('Pins umkehren und direction_pin finden', () => {
  assert.equal(invertPin('gpio.14'), 'gpio.14:low');
  assert.equal(invertPin('i2so.2:low'), 'i2so.2');
  assert.equal(invertPin('gpio.14:pu:low'), 'gpio.14:pu');
  assert.equal(directionPinPath(conf, 'x'), 'axes/x/motor0/stepstick/direction_pin');
  assert.equal(directionPinPath(conf, 'z'), null);
});

test('Kühlmittel und Ausgänge', () => {
  assert.deepEqual(coolantPins(conf), { flood: false, mist: true });
  assert.equal(coolantPins({}), null);
  assert.match(airProblem(conf, 'M8')!, /M7/);
  assert.equal(airProblem(conf, 'M7'), null);
  assert.equal(airProblem({}, 'M8'), null);
  assert.deepEqual(digitalOutputs(conf), [{ n: 0, pin: 'gpio.25' }, { n: 3, pin: 'gpio.26:low' }]);
});

test('Ausgänge im Job: an vor der ersten Bewegung, aus nach der letzten', () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), jobOutputs: [0, 3] };
  assert.deepEqual(gcodeFooter(d), ['M5', 'G4 P0', 'M65 P0', 'M65 P3', 'M2']);
  const mv = new Moves(0, 0);
  mv.push(10, 0, 0, 0, 1);
  mv.push(20, 0, 1000, 0.5, 1);
  const job = { moves: mv, bounds: { x0: 10, y0: 0, x1: 20, y1: 0 }, travel: null, hull: [], warnings: [], offset: { x: 0, y: 0 }, air: [] };
  const g = writeGCode(job, d, estimate(mv, d)).lines;
  const k = g.indexOf('M4 S0');
  assert.deepEqual(g.slice(k + 1, k + 3), ['M64 P0', 'M64 P3']);
  assert.ok(g.indexOf('M64 P3') < g.findIndex((l) => /^G[01]/.test(l)));
  assert.deepEqual(gcodeFooter(newDevice({ fw: 'fluidnc' })), ['M5', 'M2']);
});

test('Assistent: FluidNC-Befunde mit Vorschlag zum Beheben', () => {
  const facts: Facts = { ...emptyFacts(), fw: 'fluidnc', version: 'FluidNC 3.7.8', fluid: conf, fluidFile: 'e6.yaml' };
  const device = newDevice({ fw: 'fluidnc', bedW: 365, bedH: 305 });
  const all = checkConfig({ facts, device, switches: 'no', state: 'Idle', mpos: [0, 0, 0], wco: null });
  const must = all.find((f) => f.id === 'musthome')!;
  assert.deepEqual(must.fix?.send, ['$/start/must_home=false', '$CD=e6.yaml']);
  assert.deepEqual(must.fix?.undo, ['$/start/must_home=true', '$CD=e6.yaml']);
  const homing = all.find((f) => f.id === 'homing')!;
  assert.deepEqual(homing.fix?.send, ['$/axes/x/homing/cycle=0', '$/axes/y/homing/cycle=0', '$CD=e6.yaml']);
  // Air Assist: nur Mist eingetragen, Gerät schaltet M8
  const air = all.find((f) => f.id === 'air')!;
  assert.equal(air.level, 'warn');
  assert.deepEqual(air.fix?.app, { airCmd: 'M7' });
  const dir = directionFix('y', facts)!;
  assert.deepEqual(dir.send, ['$/axes/y/motor0/stepstick/direction_pin=i2so.5:low', '$CD=e6.yaml']);
});

test('Suche: Antwort auf [ESP800]', () => {
  assert.deepEqual(parseEsp800('FW version: FluidNC v3.7.8 # FW target:grbl-embedded # FW HW:Direct SD # hostname:e6pro # axis:3'), { version: 'FluidNC v3.7.8', hostname: 'e6pro' });
  assert.equal(parseEsp800('FW version: 3.0.0.a111 # FW target:marlin'), null);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
