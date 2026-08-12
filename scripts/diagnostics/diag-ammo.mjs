// 诊断4：检查 ammo.js 的 setParam/setDamping 支持 + 刚体 damping 参数
globalThis.Ammo = await (await import('ammojs-typed/ammo/ammo.js')).default();
console.log('Ammo loaded:', typeof Ammo);
const bt = Ammo;
console.log('btGeneric6DofSpringConstraint proto methods:');
const proto = bt.btGeneric6DofSpringConstraint.prototype;
const methods = Object.getOwnPropertyNames(proto).filter(n => /setParam|setDamping|setStiffness|enableSpring|setEquilibrium/.test(n));
console.log(methods.join(', '));
