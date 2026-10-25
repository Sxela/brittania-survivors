import test from 'node:test';
import assert from 'node:assert/strict';
import {joystickPreferences,joystickVector,thumbJoystickAvailable} from '../game/mobile.mjs';

test('narrow portrait desktop offers the joystick without touch hardware or a forced mobile URL',()=>{
 assert.equal(thumbJoystickAvailable({width:390,height:844}),true);
 assert.equal(thumbJoystickAvailable({width:760,height:900}),true);
 assert.equal(thumbJoystickAvailable({width:1280,height:900}),false);
 assert.equal(thumbJoystickAvailable({width:844,height:390}),false);
 assert.equal(thumbJoystickAvailable({width:844,height:390,touch:true}),true);
 assert.equal(thumbJoystickAvailable({width:1280,height:900,forced:true}),true);
});

test('joystick preferences handle missing or corrupt saved settings and bound screen placement',()=>{
 assert.deepEqual(joystickPreferences(null),{enabled:false,scale:1,x:8,y:70});
 assert.deepEqual(joystickPreferences({enabled:'true',scale:Infinity,x:NaN,y:'50'}),joystickPreferences());
 assert.deepEqual(joystickPreferences({enabled:true,scale:7,x:-30,y:250}),{enabled:true,scale:2,x:0,y:100});
 assert.equal(joystickPreferences({scale:.2}).scale,.75);
});
test('joystick dead zone stops drift and circular clamping preserves diagonal direction',()=>{
 assert.deepEqual(joystickVector(1,1,40),{x:0,y:0});
 assert.deepEqual(joystickVector(20,0,40),{x:.5,y:0});
 const diagonal=joystickVector(100,-100,40);
 assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-10);
 assert.equal(diagonal.x,-diagonal.y);
 assert.deepEqual(joystickVector(0,0,0),{x:0,y:0});
});
