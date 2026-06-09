export const resilientFetch = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, { ...options, cache: "no-store" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Failed after retries");
};
