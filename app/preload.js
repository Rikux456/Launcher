// Puente entre la interfaz (página web) y el launcher. La página solo puede pedir estas cosas.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = name => (...a) => ipcRenderer.invoke(name, ...a);
const on = ch => cb => ipcRenderer.on(ch, (_e, d) => cb(d));
contextBridge.exposeInMainWorld('launcher', {
  init: call('init'), setPref: call('setPref'), check: call('check'), update: call('update'),
  targets: call('targets'), chooseTarget: call('chooseTarget'), chooseFolder: call('chooseFolder'), openFolder: call('openFolder'),
  createInstance: call('createInstance'), cancelWait: call('cancelWait'), waitForLauncher: call('waitForLauncher'), keepOfficial: call('keepOfficial'),
  play: call('play'), uninstall: call('uninstall'), openExternal: call('openExternal'), minimize: call('minimize'), close: call('close'), restartToUpdate: call('restartToUpdate'),
  onProgress: on('progress'), onTarget: on('target'), onInstanceCreated: on('instance-created'), onInstanceTimeout: on('instance-timeout'),
  onLauncherInstalled: on('launcher-installed'), onLauncherUpdate: on('launcher-update'),
});
