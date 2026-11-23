/** Image helpers for camera capture and vocabulary thumbnails. */

/**
 * Captures a center-cropped square frame from a playing video, scaled to at most `size` px.
 * Gallery sends the model a 512×512 frame; the same size works well for Gemini.
 */
export function captureSquareFrame(video: HTMLVideoElement, size = 512, quality = 0.85): string | null {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const side = Math.min(w, h);
    const out = Math.min(size, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    return canvas.toDataURL('image/jpeg', quality);
}

/** Downscales an image data URL to a square thumbnail (small enough to store in a Firestore doc). */
export function makeThumbnail(dataUrl: string, size = 256, quality = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas unavailable'));
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = dataUrl;
    });
}

/** Reads a user-picked image file as a center-cropped square JPEG data URL. */
export async function fileToSquareDataUrl(file: File, size = 512): Promise<string> {
    const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
    return makeThumbnail(raw, size, 0.85);
}
