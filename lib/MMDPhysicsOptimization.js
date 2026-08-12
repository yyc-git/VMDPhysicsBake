/**
 * MMD 物理优化纯逻辑模块（p1-3a FPS 自适应 / p1-7b 距离 LOD）
 *
 * 与 MMDPhysics.js / MMDAnimationHelper.js 解耦，可独立单测（无需 Ammo / three）。
 * 仅包含确定性决策函数；副作用（console 日志、interval 写入）由调用方完成。
 *
 * 注意：碰撞隔离（p0-7a）已移除，当前架构为每角色独立 physics world。
 */

const LOD_BOUNDARIES = {
	// 相邻两档之间切换的边界：档位 i 与 i+1 之间的边界为 LOD_BOUNDARIES[i]
	2: 15,
	3: 30,
	4: 60
};

const LOD_DEFAULT_INTERVAL = 2;
export const LOD_HYSTERESIS = 3;

/**
 * 距离 → 原始目标档位（无 hysteresis）
 * @param {number} distance
 * @returns {number} 2 | 3 | 4 | 5
 */
export function getTargetLodInterval(distance) {
	if (distance < 15) return 2;
	if (distance < 30) return 3;
	if (distance < 60) return 4;
	return 5;
}

/**
 * 带 hysteresis 的距离 LOD 决策。
 * 上切（i→i+1）需要 distance >= 边界 + hysteresis；下切（i+1→i）需要 distance < 边界 - hysteresis。
 * @param {number} distance
 * @param {number} currentInterval 当前档位（2-5）
 * @param {number} [hysteresis=LOD_HYSTERESIS]
 * @returns {{ interval: number, anomaly: boolean }}
 */
export function computeLodInterval(distance, currentInterval = LOD_DEFAULT_INTERVAL, hysteresis = LOD_HYSTERESIS) {
	if (typeof distance !== 'number' || !isFinite(distance)) {
		return { interval: LOD_DEFAULT_INTERVAL, anomaly: true };
	}
	const target = getTargetLodInterval(distance);
	if (target === currentInterval) {
		return { interval: target, anomaly: false };
	}
	if (target > currentInterval) {
		const boundary = LOD_BOUNDARIES[currentInterval];
		if (distance >= boundary + hysteresis) {
			return { interval: target, anomaly: false };
		}
		return { interval: currentInterval, anomaly: false };
	}
	// target < currentInterval
	const boundary = LOD_BOUNDARIES[target];
	if (distance < boundary - hysteresis) {
		return { interval: target, anomaly: false };
	}
	return { interval: currentInterval, anomaly: false };
}

const FPS_DEFAULT = {
	windowSize: 30,
	debounceFrames: 60,
	lowThreshold: 25,
	recoverThreshold: 40,
	hysteresis: 2,
	minInterval: 1,
	maxInterval: 5,
	// 已达上限的 warn 冷却帧数：避免低帧率持续时日志洪水（5s @ 60fps）
	warnCooldownFrames: 300
};

/**
 * FPS 自适应控制器（30 帧滑动平均 + 60 帧防抖 + hysteresis ±2fps）。
 * 用法：每帧调用 record(fps)，随后 decide(currentInterval) 获取决策。
 */
export class FpsAdaptiveController {
	constructor(opts = {}) {
		this.windowSize = opts.windowSize ?? FPS_DEFAULT.windowSize;
		this.debounceFrames = opts.debounceFrames ?? FPS_DEFAULT.debounceFrames;
		this.lowThreshold = opts.lowThreshold ?? FPS_DEFAULT.lowThreshold;
		this.recoverThreshold = opts.recoverThreshold ?? FPS_DEFAULT.recoverThreshold;
		this.hysteresis = opts.hysteresis ?? FPS_DEFAULT.hysteresis;
		this.minInterval = opts.minInterval ?? FPS_DEFAULT.minInterval;
		this.maxInterval = opts.maxInterval ?? FPS_DEFAULT.maxInterval;
		this.warnCooldownFrames = opts.warnCooldownFrames ?? FPS_DEFAULT.warnCooldownFrames;
		this.samples = [];
		this.stableFrames = 0;
		this.lastDirection = null;
		this._warnCooldown = 0;
	}

	/** 记录一帧 FPS */
	record(fps) {
		this.samples.push(fps);
		if (this.samples.length > this.windowSize) this.samples.shift();
	}

	/** 滑动窗口平均 FPS；数据不足返回 null */
	getAverageFps() {
		if (this.samples.length < this.windowSize) return null;
		const sum = this.samples.reduce((acc, v) => acc + v, 0);
		return sum / this.samples.length;
	}

	/**
	 * 基于当前 interval 做决策。
	 * 统一返回类型：始终含 changed + level（无日志时 level 为 null）。
	 * @param {number} currentInterval
	 * @returns {{ changed: boolean, nextInterval?: number, level: 'info'|'warn'|null, message: string|null }}
	 */
	decide(currentInterval) {
		// warn 冷却期：每次调用递减（未冷却完成时不输出 warn，避免日志洪水）
		if (this._warnCooldown > 0) this._warnCooldown--;

		const avg = this.getAverageFps();
		if (avg === null) {
			// 数据不足 30 帧：不做决策、不输出日志
			return { changed: false, level: null, message: null };
		}

		// 方向判定（含 hysteresis：上下沿不对称）
		let direction = 'neutral';
		if (avg < this.lowThreshold) {
			direction = 'degrade'; // 帧率过低 → 增大 interval
		} else if (avg >= this.recoverThreshold + this.hysteresis) {
			direction = 'recover'; // 帧率充足 → 减小 interval
		}

		if (direction === 'neutral') {
			this.stableFrames = 0;
			this.lastDirection = null;
			return { changed: false, level: null, message: null };
		}

		if (direction === this.lastDirection) {
			this.stableFrames++;
		} else {
			this.stableFrames = 1;
			this.lastDirection = direction;
		}

		// 防抖：状态需稳定达到 debounceFrames 才切换
		if (this.stableFrames < this.debounceFrames) {
			return { changed: false, level: null, message: null };
		}

		let nextInterval;
		if (direction === 'degrade') {
			nextInterval = currentInterval + 1;
			if (nextInterval > this.maxInterval) {
				this.stableFrames = 0;
				// 已达上限：warn 带冷却期，避免持续低帧率时日志洪水
				if (this._warnCooldown > 0) {
					this._warnCooldown--;
					return { changed: false, level: null, message: null };
				}
				this._warnCooldown = this.warnCooldownFrames;
				const message = `FPS 自适应: 已达上限 interval=${currentInterval}, avgFPS=${Math.round(avg)}`;
				return { changed: false, level: 'warn', message };
			}
			this.stableFrames = 0;
			const message = `FPS 自适应: interval ${currentInterval}→${nextInterval} (avgFPS=${Math.round(avg)}, threshold=${this.lowThreshold})`;
			return { changed: true, nextInterval, level: 'info', message };
		}

		// recover
		nextInterval = currentInterval - 1;
		if (nextInterval < this.minInterval) {
			this.stableFrames = 0;
			// 已达最小值：不切换、不输出变更日志
			return { changed: false, level: null, message: null };
		}
		this.stableFrames = 0;
		const message = `FPS 自适应: interval ${currentInterval}→${nextInterval} (avgFPS=${Math.round(avg)}, threshold=${this.recoverThreshold})`;
		return { changed: true, nextInterval, level: 'info', message };
	}
}
