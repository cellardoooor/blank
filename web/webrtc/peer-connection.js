/**
 * PeerConnection class for WebRTC communication
 * Handles creating peer connections, offers, answers, and ICE candidates
 * @param {string} userId - The user ID for this peer connection
 * @param {string} callType - The type of call ('audio' or 'video')
 * @param {Object|null} iceServers - Optional ICE servers configuration. If null, uses default STUN servers.
 *   Expected format: { iceServers: [{ urls: 'stun:...' }, { urls: 'turn:...', username: '...', credential: '...' }] }
 */
class PeerConnection {
  constructor(userId, callType, iceServers = null) {
    this.userId = userId;
    this.callType = callType;
    this.connection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.iceServers = iceServers || {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  async createPeerConnection() {
    this.connection = new RTCPeerConnection(this.iceServers);
    
    // Handle ICE candidate events
    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        // Send ICE candidate to signaling server
        window.dispatchEvent(new CustomEvent('iceCandidate', {
          detail: {
            userId: this.userId,
            candidate: event.candidate
          }
        }));
      }
    };

    // Handle track events (remote stream)
    this.connection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      window.dispatchEvent(new CustomEvent('remoteStream', {
        detail: {
          userId: this.userId,
          stream: this.remoteStream
        }
      }));
    };

    // Handle connection state changes
    this.connection.onconnectionstatechange = () => {
      console.log(`Connection state: ${this.connection.connectionState}`);
      if (this.connection.connectionState === 'failed' || 
          this.connection.connectionState === 'disconnected') {
        window.dispatchEvent(new CustomEvent('connectionState', {
          detail: {
            userId: this.userId,
            state: this.connection.connectionState
          }
        }));
      }
    };

    return this.connection;
  }

  async createOffer() {
    if (!this.connection) {
      await this.createPeerConnection();
    }

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    return offer;
  }

  async createAnswer() {
    if (!this.connection) {
      await this.createPeerConnection();
    }

    console.log('createAnswer called, connection state:', this.connection.connectionState);
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(sdp) {
    if (!this.connection) {
      await this.createPeerConnection();
    }
    console.log('setRemoteDescription called with:', sdp);
    try {
      await this.connection.setRemoteDescription(sdp);
      console.log('setRemoteDescription succeeded, connection state:', this.connection.connectionState);
    } catch (err) {
      console.error('Failed to set remote description:', err);
      throw err;
    }
  }

  async addIceCandidate(candidate) {
    if (!this.connection) {
      await this.createPeerConnection();
    }
    await this.connection.addIceCandidate(candidate);
  }

  async getLocalStream() {
    if (this.localStream) {
      return this.localStream;
    }

    const constraints = {
      audio: true,
      video: this.callType === 'video'
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Add local stream to peer connection
      if (this.connection) {
        this.localStream.getTracks().forEach(track => {
          this.connection.addTrack(track, this.localStream);
        });
      }
      return this.localStream;
    } catch (err) {
      console.error('Error getting local stream:', err);
      throw err;
    }
  }

  close() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
  }
}
