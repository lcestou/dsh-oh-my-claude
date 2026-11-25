// The pausable close timer: it fires after its running time only, a pause holds what is left, and
// a stop means it never fires.
import { strict as assert } from "node:assert";
import { holdTimer } from "./hold-timer.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

{
  let fired = 0;
  const timer = holdTimer(60, () => fired++);
  await wait(80);
  assert.equal(fired, 0, "starts paused");
  timer.run();
  await wait(20);
  timer.pause();
  await wait(120);
  assert.equal(fired, 0, "a pause holds it past its length");
  timer.run();
  await wait(100);
  assert.equal(fired, 1, "resumes and fires once");
  timer.run();
  await wait(80);
  assert.equal(fired, 1, "never fires twice");
}
{
  let fired = 0;
  const timer = holdTimer(30, () => fired++);
  timer.run();
  timer.stop();
  timer.run();
  await wait(80);
  assert.equal(fired, 0, "a stopped timer never fires");
}
{
  // The time left is the running time only, read off the clock it is given.
  let clock = 0;
  let fired = 0;
  const timer = holdTimer(
    50,
    () => fired++,
    () => clock,
  );
  timer.run();
  clock = 40;
  timer.pause();
  clock = 1000;
  timer.run();
  await wait(5);
  assert.equal(fired, 0, "10 ms still to go");
  await wait(40);
  assert.equal(fired, 1);
}
console.log("hold-timer ok");
