// 诊断19：极简 angular limit 测试——约束是否真的限制旋转
import * as THREE from 'three';
globalThis.Ammo = await (await import('ammojs-typed/ammo/ammo.js')).default();
import { Skeleton, SkinnedMesh, Bone, BufferGeometry } from 'three';

// 手动构建两个刚体 + 一个 6DOF spring 约束，rotLim ±20°，给 bodyB 初始角速度，看能否转超过 20°
const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
const dispatcher = new Ammo.btCollisionDispatcher(collisionConfig);
const broadphase = new Ammo.btDbvtBroadphase();
const solver = new Ammo.btSequentialImpulseConstraintSolver();
const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
world.setGravity(new Ammo.btVector3(0, -9.8, 0));

const mkBody = (pos, weight) => {
  const shape = new Ammo.btBoxShape(new Ammo.btVector3(0.5, 0.5, 0.5));
  const localInertia = new Ammo.btVector3(0, 0, 0);
  shape.calculateLocalInertia(weight, localInertia);
  const state = new Ammo.btDefaultMotionState();
  const tf = new Ammo.btTransform();
  tf.setIdentity();
  tf.setOrigin(new Ammo.btVector3(pos[0], pos[1], pos[2]));
  state.setWorldTransform(tf);
  const info = new Ammo.btRigidBodyConstructionInfo(weight, state, shape, localInertia);
  const body = new Ammo.btRigidBody(info);
  body.setDamping(0.5, 0.5);
  world.addRigidBody(body, 1, 0xffff);
  return body;
};

// bodyA 固定（mass 0 → static），bodyB 动态
const bodyA = mkBody([0, 0, 0], 0);
const bodyB = mkBody([2, 0, 0], 1);

// 6DOF spring 约束：frame 在 bodyB 位置，rotLim ±20°
const frameInA = new Ammo.btTransform();
frameInA.setIdentity();
frameInA.setOrigin(new Ammo.btVector3(2, 0, 0));
const frameInB = new Ammo.btTransform();
frameInB.setIdentity();
frameInB.setOrigin(new Ammo.btVector3(0, 0, 0));
const cst = new Ammo.btGeneric6DofSpringConstraint(bodyA, bodyB, frameInA, frameInB, true);
const lll = new Ammo.btVector3(0, 0, 0), lul = new Ammo.btVector3(0, 0, 0);
const all = new Ammo.btVector3(-0.349, -0.349, -0.349), aul = new Ammo.btVector3(0.349, 0.349, 0.349);
cst.setLinearLowerLimit(lll); cst.setLinearUpperLimit(lul);
cst.setAngularLowerLimit(all); cst.setAngularUpperLimit(aul);
world.addConstraint(cst, true);

// 给 bodyB 一个大力矩（模拟动画驱动）
const torque = new Ammo.btVector3(0, 0, 50);
const angVel = new Ammo.btVector3(0, 0, 5);
bodyB.applyTorque(torque);
bodyB.setAngularVelocity(angVel);

for (let i = 0; i < 300; i++) {
  world.stepSimulation(1 / 60, 3, 1 / 65);
}
const tfB = new Ammo.btTransform();
bodyB.getMotionState().getWorldTransform(tfB);
const q = tfB.getRotation();
const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w()))) * 180 / Math.PI;
console.log('极简测试: bodyB 最终旋转角 =', angle.toFixed(1), '° (rotLim ±20°，若 >20° 说明 limit 未生效)');
Ammo.destroy(tfB);
Ammo.destroy(angVel);
Ammo.destroy(torque);
