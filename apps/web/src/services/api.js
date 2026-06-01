import axios from "axios";

const candidateBaseUrls = [
  import.meta.env.VITE_API_BASE_URL,
  "http://localhost:4310/api",
  "http://localhost:3000/api",
  "http://localhost:3001/api"
].filter((baseUrl, index, allBaseUrls) => {
  return Boolean(baseUrl) && allBaseUrls.indexOf(baseUrl) === index;
});

let resolvedBaseUrl = candidateBaseUrls[0] || "http://localhost:4310/api";

async function request(method, url, config = {}) {
  let lastError;

  for (const baseURL of candidateBaseUrls) {
    try {
      const response = await axios({
        method,
        url,
        baseURL,
        timeout: 10000,
        ...config
      });

      resolvedBaseUrl = baseURL;
      return response;
    } catch (error) {
      lastError = error;

      if (error.response && error.response.status < 500) {
        throw error;
      }
    }
  }

  throw lastError;
}

const api = {
  get(url, config) {
    return request("get", url, config);
  },
  post(url, data, config = {}) {
    return request("post", url, { ...config, data });
  },
  put(url, data, config = {}) {
    return request("put", url, { ...config, data });
  },
  delete(url, config) {
    return request("delete", url, config);
  }
};

export function getResolvedApiBaseUrl() {
  return resolvedBaseUrl;
}

export default api;
