export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
    const obj = await bucket.get(key);
    if (!obj) {
        return null;
        try {
            return JSON.parse(await obj.text()) as T;
        } catch (err) {
            // Fail closed if malformed JSON is stored in R2.
            console.error("Failed to parse JSON from R2", key, err);
            return null;
        }

    }
}