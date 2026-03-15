/**
 * MediaUtils class for media stream handling
 * Provides utilities for getting local stream, muting/unmuting, etc.
 */
class MediaUtils {
  constructor() {
    this.localStream = null;
    this.audioEnabled = true;
    this.videoEnabled = false;
  }

  async getLocalStream(callType = 'audio') {
    if (this.localStream) {
      return this.localStream;
    }

    const constraints = {
      audio: true,
      video: callType === 'video'
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioEnabled = true;
      this.videoEnabled = callType === 'video';
      return this.localStream;
    } catch (err) {
      console.error('Error getting local stream:', err);
      throw err;
    }
  }

  async toggleAudio() {
    if (!this.localStream) return this.audioEnabled;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.audioEnabled = !this.audioEnabled;
      audioTrack.enabled = this.audioEnabled;
    }
    return this.audioEnabled;
  }

  async toggleVideo() {
    if (!this.localStream) return this.videoEnabled;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.videoEnabled = !this.videoEnabled;
      videoTrack.enabled = this.videoEnabled;
    }
    return this.videoEnabled;
  }

  async stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.audioEnabled = true;
    this.videoEnabled = false;
  }

  async getScreenStream() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      return screenStream;
    } catch (err) {
      console.error('Error getting screen stream:', err);
      throw err;
    }
  }

  async toggleScreenShare(screenStream) {
    if (!this.localStream) return null;

    // Replace video track with screen share track
    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
      // This would require renegotiation in a real implementation
      // For now, just return the screen stream
      return screenStream;
    }
    return null;
  }

  // Get current media state
  getMediaState() {
    return {
      audioEnabled: this.audioEnabled,
      videoEnabled: this.videoEnabled
    };
  }

  // Set media state
  setMediaState(state) {
    if (state.audioEnabled !== undefined) {
      this.audioEnabled = state.audioEnabled;
    }
    if (state.videoEnabled !== undefined) {
      this.videoEnabled = state.videoEnabled;
    }
  }
}
