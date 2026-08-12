import { Camera, AnimationClip, FileLoader, Loader, LoadingManager, SkinnedMesh } from 'three';
import { nullable } from "../utils/nullable"


export interface MMDLoaderAnimationObject {
	animation: AnimationClip;
	mesh: SkinnedMesh;
}

/*!edit by meta3d */
export interface MMDLoaderAnimationObject2 {
	animation: Array<[string, AnimationClip]>;
	mesh: SkinnedMesh;
}


export class MMDLoader extends Loader<SkinnedMesh> {
	constructor(manager?: LoadingManager);
	animationBuilder: object;
	animationPath: string;
	loader: FileLoader;
	meshBuilder: object;
	parser: object | null;

	loadAnimation(
		url: string,
		object: SkinnedMesh | Camera,
		onLoad: (object: SkinnedMesh | AnimationClip) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	loadPMD(
		url: string,
		onLoad: (object: object) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	loadPMX(
		url: string,
		onLoad: (object: object) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	loadVMD(
		url: string,
		onLoad: (object: object) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	loadVPD(
		url: string,
		isUnicode: boolean,
		onLoad: (object: object) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	loadWithAnimation(
		url: string,
		vmdUrl: string | string[],
		onLoad: (object: MMDLoaderAnimationObject) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
	): void;
	setAnimationPath(animationPath: string): this;


	/*!edit by meta3d */
	loadAnimation2(
		[allVMDData, allVMDBufferData]: [Array<[string, string]>, Array<[string, nullable<ArrayBuffer>]>],
		setVMDCacheFunc: (vmdUrl: string, vmdArrayBuffer: ArrayBuffer) => Promise<ArrayBuffer>,
		markLoadedOneVMDFunc: () => void,
		object: SkinnedMesh,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (event: ErrorEvent) => void,
		positionScaleCoefficients?: Record<string, number> | null,
	): Promise<Array<[string, AnimationClip]>>;
	loadVMD2(
		url: string,
		onLoad: ([url, buffer, vmd]: [string, ArrayBuffer, object]) => void,
		onProgress?: (event: ProgressEvent) => void,
		onError?: (error: Error) => void,
	): void;
	// loadWithAnimation2(url: string, allVMDData: Array<[string, string]>, onLoad: (object: MMDLoaderAnimationObject2) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): void;
	loadWithAnimation2([url, modelArrayBuffer]: [string, nullable<ArrayBuffer>],
		setPMXCacheFunc: (modelArrayBuffer: ArrayBuffer) => Promise<ArrayBuffer>,
		setVMDCacheFunc: (vmdUrl: string, vmdArrayBuffer: ArrayBuffer) => Promise<ArrayBuffer>,
		markLoadedOneVMDFunc: () => void,
		[allVMDData, allVMDBufferData]: [Array<[string, string]>, Array<[string, nullable<ArrayBuffer>]>],
		onLoad: (object: MMDLoaderAnimationObject2) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void,
		positionScaleCoefficients?: Record<string, number> | null): void;
}


/*!edit by meta3d */
export function decompressVMDBuffer(buffer: ArrayBuffer): ArrayBuffer | null;
