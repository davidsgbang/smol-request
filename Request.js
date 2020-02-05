// docs: https://nodejs.org/dist/latest-v10.x/docs/api/https.html#https_https_request_url_options_callback
import qs from 'querystring'
import https from 'https'
import http from 'http'
import fs from 'fs'
import { createUnzip } from 'zlib'
import { cleanObject, mergeUrl, deepmerge } from './lib/index.js'
const pkg = JSON.parse(fs.readFileSync('./package.json'))
const nativeRequestKeys = ['protocol', 'host', 'hostname', 'family', 'port', 'localAddres', 'socketPath', 'method', 'path', 'auth', 'agent', 'createConnection', 'timeout']

export default function smolrequest (url, options = {}, formData) {
  const [data, dataIsObject] = Object.prototype.toString.call(formData) === '[object Object]' ? [qs.stringify(formData), true] : [formData, false]
  const mergedOptions = [
    {
      method: 'GET',
      responseType: 'text',
      headers: { 'User-Agent': `smol-request/${pkg.version}` }
    }
  ]
  if (dataIsObject && data) {
    mergedOptions.push(
      { headers: { 'Content-Length': Buffer.byteLength(data) } }
    )
  }
  mergedOptions.push(options)
  if (options.responseType && options.responseType === 'buffer') {
    mergedOptions.push(
      { headers: { 'Content-Type': 'application/octet-stream' } }
    )
  }
  const requestOptions = deepmerge(mergedOptions)
  if (requestOptions.params && typeof requestOptions.params === 'object') {
    url = mergeUrl(url, requestOptions.params)
  }
  return new Promise((resolve, reject) => {
    function resHandler (res) {
      const result = {
        data: null,
        headers: res.headers,
        status: res.statusCode,
        statusText: res.statusMessage
      }
      if (requestOptions.responseType === 'headers') {
        return resolve(result)
      }
      const stream = ['gzip', 'compress', 'deflate'].includes(res.headers['content-encoding']) && res.statusCode === 204
        ? res.pipe(createUnzip())
        : res
      if (requestOptions.responseType === 'stream') {
        result.data = stream
        return resolve(result)
      }
      // stream.setEncoding('utf8')
      const responseData = []
      const onData = chunk => { responseData.push(requestOptions.responseType === 'buffer' ? Buffer.from(chunk) : chunk) }
      const onError = err => {
        stream.removeListener('error', onError)
        stream.removeListener('data', onData)
        reject(err)
      }
      const onClose = () => {
        stream.removeListener('error', onError)
        stream.removeListener('data', onData)
        stream.removeListener('end', onClose)
        if (requestOptions.responseType === 'buffer') {
          result.data = Buffer.concat(responseData)
        } else if (requestOptions.responseType === 'json') {
          try {
            result.data = JSON.parse(responseData)
          } catch (e) {
            return reject(new Error(`JSON parsing error: ${e.message}: ${responseData}`))
          }
        } else {
          result.data = responseData.join('')
        }
        resolve(result)
      }
      stream.on('data', onData)
      stream.on('error', onError)
      stream.on('end', onClose)
    }
    const client = url.startsWith('https') ? https : http
    const req = client.request(
      url,
      cleanObject(requestOptions, nativeRequestKeys),
      resHandler
    )
    if (requestOptions.headers) {
      Object.entries(requestOptions.headers)
        .forEach(([name, value]) => req.setHeader(name, value))
    }
    const onError = err => {
      req.removeListener('error', onError)
      reject(err)
    }
    req.on('error', onError)
    if (data) { req.write(data) }
    req.end()
  })
}
