'use strict';
compare_token()

let peerConnection;
let sendChannel;
let fileReader;

/**
 * Return dom element
 * @param {object} id_name – id of the element
 * @returns {object}
 */
const elem = (id_name) => document.getElementById(id_name)

/**
 * Log data about RTC
 * @param  {...any} info – information
 * @returns {undefined}
 */
const log = (...info) => console.log('%c[RTC]', `color: green;`, ...info)

// Channel for communicate between window and worker(tcp_conn.js)
const broadcast = new BroadcastChannel('tcp_channel');
broadcast.addEventListener('message', async ({ data }) => {
  if (!data.offer) {
    console.log('[WS MSG]', data)
  }
})  

/**
 * Send message\object to the tcp server
 * @param {*} data – data for server 
 * @returns {undefined}
 */
const send_to_server = (data) => {
  /**
   * If websocket connection use like signaling channel
   * then we send offer and wait until server send offer back.
   */
  if (data.offer) {
    return new Promise((resolve, reject) => {
      broadcast.postMessage(data)
      broadcast.addEventListener('message', ({ data }) => {
        if ('offer' in data) {
          console.log('OFFER from server', data)
          resolve(data)
        }   
      })
    })
  }
  broadcast.postMessage(data)
}
document.getElementById('send_btn').onclick = () => {
  send_to_server({ msg: prompt('msg?') })
};

elem('sendFile').onclick = createConnection

/**
 * Create RTC peer connection
 * @returns {undefined}
 */
async function createConnection() {
  /**
   * Configuration for peer connection
   * https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection
   */
  const configuration = {
    iceServers: [{'urls': 'stun:stun.l.google.com:19302'}],
    sdpSemantics: 'unified-plan',
    // sdpSemantics: 'plan-b', // another future of the sdpSemantics
    bundlePolicy: "max-compat"
  }

  peerConnection = new RTCPeerConnection(configuration)
  log('Created local peer connection object peerConnection.')

  peerConnection.addEventListener('icecandidate', e => {
    if (e.candidate) {
      /**
       * Wait until iceGatheringState complete
       * then send ice candidate to the server.
       */
      new Promise((resolve, reject) => {
        function checkState() {
          if (peerConnection.iceGatheringState === 'complete') {
            peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        }
        peerConnection.addEventListener('icegatheringstatechange', checkState)
      })
      .then(() => {
        send_to_server({ 'new-ice-candidate':  JSON.stringify(e.candidate) })
      })
    }
  })

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    log('iceconnectionstatechange:', peerConnection.iceConnectionState)
  })

  peerConnection.addEventListener('signalingstatechange', () => {
    log('signalingstatechange:', peerConnection.signalingState)
  })

  /**
   * Options for data channel
   * https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel
   */
  const channel_options = {
    protocol: 'TCP'
  }

  /**
   * createDataChannel docs
   * https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel
   */
  sendChannel = peerConnection.createDataChannel('ft', channel_options)

  /**
   * sendChannel options docs
   * https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/binaryType
   */
  sendChannel.binaryType = 'arraybuffer'
  log('Created send data channel.')

  sendChannel.addEventListener('open', onSendChannelStateChange);
  sendChannel.addEventListener('close', onSendChannelStateChange);
  sendChannel.addEventListener('error', onError);
  sendChannel.addEventListener('message', (d) => log('Data from channel', d))

  peerConnection.createOffer()
    .then(offer => peerConnection.setLocalDescription(offer))
    .then(() => {
      // Wait until peer complete
      return new Promise((resolve, reject) => {
        if (peerConnection.iceGatheringState === 'complete') {
          resolve()
        } else {
          function checkState() {
            if (peerConnection.iceGatheringState === 'complete') {
              peerConnection.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          }
          peerConnection.addEventListener('icegatheringstatechange', checkState)
        }
      })
    })
    .then(() => {
      // Send over out signaling server offer
      const offer = peerConnection.localDescription
      return send_to_server({ offer: JSON.stringify(offer) })
    })
    .then(async (data) => {
      // Receive offer from remote peer and set it
      const remoteDesc = new RTCSessionDescription(data.offer)
      log('Remote desc', remoteDesc)
      await peerConnection.setRemoteDescription(remoteDesc)
    })
}

/**
 * Handle sendChannel state
 * @returns {undefined}
 */
function onSendChannelStateChange() {
  if (sendChannel) {
    const { readyState } = sendChannel
    log('Send channel state is:', readyState)
    /**
     * When peerConnection establish and sendCannel state is open, 
     * start sending chunks of the file.
     */
    if (readyState === 'open') {
      sendFile()
    }
  }
}

/**
 * Send file via peerConnection
 * @returns {undefined}
 */
function sendFile() {
  const file = elem('fileInput').files[0]
  console.log(`[FILE] ${[file.name, file.size, file.type, file.lastModified].join(' ')}`)

  const file_info = {
    name: file.name,
    size: file.size,
    type: file.type,
    dir: '/test/',
    lastModified: file.lastModified
  }
  // Send metadata about file
  sendChannel.send(JSON.stringify(file_info))

  const chunkSize = 16384
  fileReader = new FileReader()
  let offset = 0 

  fileReader.addEventListener('error', error => console.error('[File] reading file:', error))
  fileReader.addEventListener('abort', event => console.log('[File] reading aborted:', event))
  fileReader.addEventListener('load', e => {
    console.log('[FILE] load', e)
    sendChannel.send(e.target.result)
    offset += e.target.result.byteLength
    if (offset < file.size) {
      readSlice(offset)
    }
  })
  const readSlice = o => {
    console.log('[READ] readSlice', o)
    const slice = file.slice(offset, o + chunkSize)
    fileReader.readAsArrayBuffer(slice)
  }
  readSlice(0)
}

/**
 * Handle error from sendChannel
 * @param {Error} error
 * @returns {undefined}
 */
function onError(error) {
  console.error('Error in sendChannel:', error)
}