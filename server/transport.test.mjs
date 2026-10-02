import test from 'node:test';
import assert from 'node:assert/strict';
import {stateDelta,canSend,takeMessageToken,encodeMessage} from './transport.mjs';
test('only changed fields are sent and explicit null removes old state',()=>{
  const socket={};const first=stateDelta(socket,{type:'state',room:'AAAA',phase:'lobby',config:{rounds:3},reveal:null});
  assert.equal(first.full,true);assert.equal(stateDelta(socket,{type:'state',room:'AAAA',phase:'lobby',config:{rounds:3},reveal:null}),null);
  const next=stateDelta(socket,{type:'state',room:'AAAA',phase:'playing',config:{rounds:3},reveal:'answer'});
  assert.equal(next.full,false);assert.equal(next.phase,'playing');assert.equal(next.config,undefined);
  const clear=stateDelta(socket,{type:'state',room:'AAAA',phase:'playing',config:{rounds:3},reveal:null});assert.equal(clear.reveal,null);
  assert.deepEqual(JSON.parse(encodeMessage(clear,new Map())),clear);
});
test('slow sockets are terminated instead of retaining an unbounded queue',()=>{
  let stopped=false;assert.equal(canSend({readyState:1,bufferedAmount:300000,terminate(){stopped=true;}}),false);assert.equal(stopped,true);
});
test('input flood control recovers after the connection quiets down',()=>{
  const socket={};for(let i=0;i<40;i++)assert.equal(takeMessageToken(socket,0),true);
  assert.equal(takeMessageToken(socket,0),false);assert.equal(takeMessageToken(socket,1000),true);
});
