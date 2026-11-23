/**
 * On-device model catalog (the Glossos equivalent of Gallery's model allowlist).
 * Files are the web-optimized LiteRT-LM builds from Hugging Face, pinned to a commit.
 * Defaults follow Gallery's allowlist for Gemma 4 (topK 64, topP 0.95, 32k context).
 */

export interface OnDeviceModel {
    id: string;
    name: string;
    description: string;
    repo: string;
    file: string;
    /** Hugging Face commit the file is pinned to. */
    revision: string;
    sizeBytes: number;
    sha256: string;
    /** Rough minimum device memory for a smooth experience (Gallery's minDeviceMemoryInGb). */
    minMemoryGb: number;
    recommended?: boolean;
    license: string;
    defaults: {
        temperature: number;
        topK: number;
        topP: number;
        maxOutputTokens: number;
        contextTokens: number;
    };
}

export const ON_DEVICE_MODELS: OnDeviceModel[] = [
    {
        id: 'gemma-4-e2b',
        name: 'Gemma 4 E2B',
        description: 'Fast and light. The best choice for most laptops and recent phones.',
        repo: 'litert-community/gemma-4-E2B-it-litert-lm',
        file: 'gemma-4-E2B-it-gpu.litertlm',
        revision: '2e12bfd869b2962984f97a1f2a26807316d534cc',
        sizeBytes: 2_340_870_772,
        sha256: 'd3cfec6ae2e027a994e51366d44dbf522ec7531a4a35fbbfcd3e9cc9b927afc1',
        minMemoryGb: 8,
        recommended: true,
        license: 'Apache-2.0',
        defaults: { temperature: 0.7, topK: 64, topP: 0.95, maxOutputTokens: 1024, contextTokens: 8192 },
    },
    {
        id: 'gemma-4-e4b',
        name: 'Gemma 4 E4B',
        description: 'Smarter, but bigger and slower. Needs a strong GPU.',
        repo: 'litert-community/gemma-4-E4B-it-litert-lm',
        file: 'gemma-4-E4B-it-gpu.litertlm',
        revision: 'f254b5ba6e36f7d89cc7892e268e9877bc20f0a0',
        sizeBytes: 3_310_938_740,
        sha256: 'ea168f5a601b543e02712f9381f26b06ddc7d4cbe2406410387c82d69b995a60',
        minMemoryGb: 12,
        license: 'Apache-2.0',
        defaults: { temperature: 0.7, topK: 64, topP: 0.95, maxOutputTokens: 1024, contextTokens: 8192 },
    },
];

export function modelUrl(model: OnDeviceModel): string {
    return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`;
}

export function findModel(id: string | null | undefined): OnDeviceModel | undefined {
    return ON_DEVICE_MODELS.find(m => m.id === id);
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${Math.round(bytes / 1e3)} KB`;
}
