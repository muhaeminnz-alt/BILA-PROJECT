(function () {
  'use strict';

  /* ========================================================================
     ASSET MAP — Maskot BILA
     Saat ini baru tersedia 1 pose (bila-idle.png, dari asset yang diberikan).
     Kalau file bila-happy.png / bila-sad.png / bila-pointing.png sudah
     ditambahkan ke folder assets/mascot/, kode di bawah otomatis memakainya
     tanpa perlu diubah.
     ======================================================================== */
  var MASCOT = {
    idle: 'assets/mascot/bila-idle.png',
    happy: 'assets/mascot/bila-happy.png',
    sad: 'assets/mascot/bila-sad.png',
    pointing: 'assets/mascot/bila-pointing.png'
  };

  function setMascot(imgEl, mood) {
    if (!imgEl) return;
    var src = MASCOT[mood] || MASCOT.idle;
    imgEl.src = src;
    imgEl.onerror = function () {
      imgEl.onerror = null;
      imgEl.src = MASCOT.idle;
    };
  }

  /* ========================================================================
     SOUND SYSTEM — Web Audio API (tanpa file MP3/WAV eksternal)
     ==========================================================================
     BILA_AUDIO menyediakan sound effect UI (RFID, klik, jawaban benar/salah,
     level selesai). Semua suara melewati satu masterGain supaya volume
     terpusat & mudah dikontrol.

     PENTING: ini TERPISAH dari Text-to-Speech (speechSynthesis) yang dipakai
     tombol speaker untuk membacakan instruksi soal — TTS tidak disentuh sama
     sekali dan tetap berjalan seperti sebelumnya (lihat initSoalActions).

     AudioContext baru dibuat setelah interaksi pertama user (pointerdown),
     supaya tidak diblokir kebijakan autoplay browser. initBilaAudio() aman
     dipanggil berkali-kali: AudioContext hanya dibuat sekali, dan context
     yang 'suspended' hanya di-resume.
     ======================================================================== */
  var BILA_AUDIO = {
    ctx: null,
    masterGain: null,
    enabled: true,   // dimatikan otomatis kalau Web Audio API tidak didukung
    volume: 0.25,    // 0.20 - 0.30, jangan terlalu keras
    ready: false
  };

  var bilaLastRfidSoundAt = 0;
  var BILA_RFID_SOUND_COOLDOWN_MS = 250; // cegah sound RFID tumpang tindih; TIDAK memengaruhi pemrosesan data RFID

  function initBilaAudio() {
    if (!BILA_AUDIO.enabled) return;
    try {
      if (!BILA_AUDIO.ctx) {
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) {
          BILA_AUDIO.enabled = false;
          console.log('[BILA AUDIO] Audio unavailable');
          return;
        }
        BILA_AUDIO.ctx = new AudioCtor();
        BILA_AUDIO.masterGain = BILA_AUDIO.ctx.createGain();
        BILA_AUDIO.masterGain.gain.value = BILA_AUDIO.volume;
        BILA_AUDIO.masterGain.connect(BILA_AUDIO.ctx.destination);
        BILA_AUDIO.ready = true;
        console.log('[BILA AUDIO] AudioContext initialized');
      }
      if (BILA_AUDIO.ctx.state === 'suspended') {
        BILA_AUDIO.ctx.resume();
      }
    } catch (e) {
      BILA_AUDIO.enabled = false;
      BILA_AUDIO.ready = false;
      console.log('[BILA AUDIO] Audio unavailable');
    }
  }

  // Satu nada sinus pendek dengan envelope lembut (attack/release) supaya
  // tidak ada "klik" kasar di awal/akhir nada. startOffset dalam detik,
  // relatif terhadap saat function ini dipanggil.
  function bilaPlayTone(freq, startOffset, duration, peakGain, waveType) {
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready || !BILA_AUDIO.ctx || !BILA_AUDIO.masterGain) return;
    try {
      var ctx = BILA_AUDIO.ctx;
      var now = ctx.currentTime + (startOffset || 0);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = waveType || 'sine';
      osc.frequency.setValueAtTime(freq, now);

      var peak = (peakGain === undefined) ? 1 : peakGain;
      var attack = 0.012;
      var release = Math.max(0.04, duration * 0.4);
      var sustainUntil = Math.max(now + attack, now + duration - release);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + attack);
      gain.gain.setValueAtTime(peak, sustainUntil);
      gain.gain.linearRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(BILA_AUDIO.masterGain);
      osc.start(now);
      osc.stop(now + duration + 0.03);
    } catch (e) {
      // satu nada gagal tidak boleh mengganggu fungsi utama website
    }
  }

  // "ting - pop": dipanggil saat balok terdeteksi (RFID hardware ATAU
  // tombol simulasi di modal pengaturan, lihat handleBlockPlace()).
  function soundRfid() {
    var nowMs = Date.now();
    if (nowMs - bilaLastRfidSoundAt < BILA_RFID_SOUND_COOLDOWN_MS) return; // cooldown sound saja, bukan cooldown data
    bilaLastRfidSoundAt = nowMs;
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready) return;
    bilaPlayTone(880.00, 0, 0.09, 0.22, 'sine');     // nada pertama, agak tinggi
    bilaPlayTone(1046.50, 0.09, 0.12, 0.20, 'sine'); // nada kedua, sedikit lebih tinggi ("pop")
    console.log('[BILA AUDIO] RFID sound');
  }

  // Klik UI ringan untuk tombol interaktif utama.
  function soundClick() {
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready) return;
    bilaPlayTone(600, 0, 0.045, 0.12, 'sine');
  }

  // Jawaban benar: C5 -> E5 -> G5, meningkat & positif.
  function soundCorrect() {
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready) return;
    bilaPlayTone(523.25, 0.00, 0.14, 0.22, 'sine');
    bilaPlayTone(659.25, 0.14, 0.14, 0.22, 'sine');
    bilaPlayTone(783.99, 0.28, 0.22, 0.24, 'sine');
    console.log('[BILA AUDIO] Correct answer');
  }

  // Jawaban salah: E4 -> C4, sedikit menurun tapi lembut ("coba lagi").
  function soundWrong() {
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready) return;
    bilaPlayTone(329.63, 0.00, 0.16, 0.18, 'sine');
    bilaPlayTone(261.63, 0.16, 0.20, 0.16, 'sine');
    console.log('[BILA AUDIO] Wrong answer');
  }

  // Level selesai: C5 -> E5 -> G5 -> C6, lebih meriah dari soundCorrect.
  function soundLevelComplete() {
    if (!BILA_AUDIO.enabled || !BILA_AUDIO.ready) return;
    bilaPlayTone(523.25, 0.00, 0.13, 0.22, 'sine');
    bilaPlayTone(659.25, 0.13, 0.13, 0.22, 'sine');
    bilaPlayTone(783.99, 0.26, 0.13, 0.24, 'sine');
    bilaPlayTone(1046.50, 0.39, 0.24, 0.26, 'sine');
    console.log('[BILA AUDIO] Level complete');
  }

  /* ========================================================================
     BACKSOUND — musik latar (loop, santai/relax), TERPISAH dari sound
     effect (BILA_AUDIO/Web Audio API) dan dari Text-to-Speech.
     ==========================================================================
     Pakai elemen <audio> biasa (bukan Web Audio API) supaya file musik
     panjang tidak perlu didekode ke buffer. GANTI BILA_MUSIC_SRC di bawah
     sesuai lokasi & nama file musik Anda kalau path/ekstensinya berbeda.
     Asumsi saat ini: file diletakkan di assets/audio/backsound.mp3.
     ======================================================================== */
  var BILA_MUSIC_SRC = 'assets/sound/backsound.mp3';
  var BILA_MUSIC_STORAGE_KEY = 'bila_music_muted';
  var bilaMusic = null;
  var bilaMusicStarted = false;

  // Aman dipanggil berkali-kali: elemen <audio> hanya dibuat sekali.
  function initBilaMusic() {
    if (bilaMusic) return;
    try {
      bilaMusic = new Audio(BILA_MUSIC_SRC);
      bilaMusic.loop = true;
      bilaMusic.volume = 0.15; // pelan, sekadar latar — jangan menutupi TTS/SFX
      bilaMusic.preload = 'auto';

      var mutedSaved = false;
      try { mutedSaved = localStorage.getItem(BILA_MUSIC_STORAGE_KEY) === '1'; } catch (e) {}
      bilaMusic.muted = mutedSaved;
      updateMusicToggleUI(!mutedSaved);

      bilaMusic.addEventListener('error', function () {
        console.log('[BILA AUDIO] Musik latar tidak tersedia (cek path file: ' + BILA_MUSIC_SRC + ')');
      });
    } catch (e) {
      bilaMusic = null;
      console.log('[BILA AUDIO] Musik latar tidak tersedia');
    }
  }

  // Dipanggil dari interaksi pertama user (gesture) supaya tidak diblokir
  // kebijakan autoplay browser. Idempotent — aman dipanggil berkali-kali.
  function playBilaMusic() {
    initBilaMusic();
    if (!bilaMusic || bilaMusicStarted) return;
    bilaMusicStarted = true;
    var playPromise = bilaMusic.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {
        // browser masih memblokir (mis. belum dianggap gesture valid) —
        // coba lagi otomatis pada interaksi berikutnya.
        bilaMusicStarted = false;
      });
    }
  }

  function toggleBilaMusic() {
    if (!bilaMusic) return;
    bilaMusic.muted = !bilaMusic.muted;
    try { localStorage.setItem(BILA_MUSIC_STORAGE_KEY, bilaMusic.muted ? '1' : '0'); } catch (e) {}
    updateMusicToggleUI(!bilaMusic.muted);
  }

  function updateMusicToggleUI(isOn) {
    var sw = document.getElementById('switchMusik');
    if (!sw) return;
    sw.classList.toggle('on', isOn);
    sw.setAttribute('aria-checked', String(isOn));
  }

  // Inisialisasi AudioContext (SFX) + mulai musik latar pada interaksi
  // pertama user (klik/tap/pointer). { once: true } supaya listener ini
  // otomatis lepas sendiri sesudah dipakai sekali.
  document.addEventListener('pointerdown', function () {
    initBilaAudio();
    playBilaMusic();
  }, { once: true });

  /* ========================================================================
     PROTOKOL KOMUNIKASI HARDWARE (ESP8266 + reader RFID RC522 pada balok)
     ==========================================================================
     Website terhubung ke ESP8266 lewat WebSocket. Setiap balok fisik punya
     tag RFID yang menyimpan nilai angka (mis. balok "3" -> nilai 3).
     Saat balok ditaruh di reader, ESP8266 mengirim pesan ke website. Website
     TIDAK menghitung tap layar — ia hanya menampilkan & memvalidasi apa yang
     dibaca dari alat.

     Format pesan yang didukung (kirim salah satu, JSON lebih disarankan):

       Format ESP8266 RFID RC522 (SAAT INI DIPAKAI):
         {"uid":"<uid_tag>","number":<angka>,"status":"detected"}

       JSON (format lama, tetap didukung):
         {"type":"place",  "uid":"<uid_tag>", "value": <angka>}
         {"type":"remove", "uid":"<uid_tag>"}
         {"type":"check"}                        // opsional: tombol fisik "Cek"
         {"type":"student","uid":"<uid_kartu>","nama":"...","nisn":"..."}

       Teks sederhana (kalau ESP8266 tidak pakai ArduinoJson):
         PLACE:<uid>:<value>
         REMOVE:<uid>
         CHECK
         STUDENT:<uid>:<nama>:<nisn>

     Bagian parseHardwareMessage() di bawah ini yang menerjemahkan semua
     format di atas menjadi pemanggilan handleBlockPlace()/handleBlockRemove()
     yang sudah ada.
     ======================================================================== */
  var ESP_STORAGE_KEY = 'bila_esp_address';
  var ESP_DEFAULT_PORT = 81;
  var hardware = {
    ws: null,
    connected: false,
    simulasi: false,
    shouldReconnect: false,
    reconnectTimer: null
  };

  // Mengubah "192.168.137.192" -> "ws://192.168.137.192:81/".
  // Jika user sudah memasukkan "ws://..." / "wss://...", dipakai apa adanya
  // (tidak ditambahkan ws:// dua kali).
  function normalizeEspAddress(input) {
    var trimmed = String(input || '').trim();
    if (!trimmed) return '';
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    trimmed = trimmed.replace(/\/+$/, ''); // buang trailing slash kalau ada
    if (!/:\d+$/.test(trimmed)) {
      trimmed += ':' + ESP_DEFAULT_PORT;
    }
    return 'ws://' + trimmed + '/';
  }

  function parseHardwareMessage(raw) {
    try {
      var msg = null;
      try {
        msg = JSON.parse(raw);
      } catch (jsonErr) {
        var parts = String(raw).trim().split(':');
        var cmd = (parts[0] || '').toUpperCase();
        if (cmd === 'PLACE') msg = { type: 'place', uid: parts[1], value: parseFloat(parts[2]) };
        else if (cmd === 'REMOVE') msg = { type: 'remove', uid: parts[1] };
        else if (cmd === 'CHECK') msg = { type: 'check' };
        else if (cmd === 'STUDENT') msg = { type: 'student', uid: parts[1], nama: parts[2], nisn: parts[3] };
      }

      if (!msg) {
        console.warn('[BILA] Data tidak dikenal / JSON tidak valid:', raw);
        return;
      }

      // Format ESP8266 + RC522 (saat ini dipakai hardware):
      // {"uid":"FF0F716D220000","number":3,"status":"detected"}
      if (!msg.type && msg.uid !== undefined && msg.number !== undefined) {
        var uidNew = (msg.uid === null || msg.uid === undefined) ? '' : String(msg.uid).trim();
        var numNew = Number(msg.number);

        if (!uidNew) {
          console.warn('[BILA] uid kosong pada data ESP8266, diabaikan:', msg);
          return;
        }
        if (isNaN(numNew)) {
          console.warn('[BILA] number bukan angka pada data ESP8266, diabaikan:', msg);
          return;
        }
        if (msg.status && msg.status !== 'detected') {
          console.log('[BILA] Status RFID diabaikan (bukan "detected"):', msg.status);
          return;
        }

        handleBlockPlace(uidNew, numNew);
        return;
      }

      if (!msg.type) {
        console.warn('[BILA] Format data tidak dikenal (tidak ada type):', raw);
        return;
      }

      if (msg.type === 'place' && msg.uid && !isNaN(msg.value)) {
        handleBlockPlace(String(msg.uid), Number(msg.value));
      } else if (msg.type === 'remove' && msg.uid) {
        handleBlockRemove(String(msg.uid));
      } else if (msg.type === 'check') {
        var btn = document.getElementById('btnCekJawaban');
        if (btn && !btn.disabled) btn.click();
      } else if (msg.type === 'student') {
        if (window.BILA_onRfidScan) window.BILA_onRfidScan(msg.uid, { nama: msg.nama, nisn: msg.nisn });
      } else {
        console.warn('[BILA] type pesan tidak dikenal:', msg.type);
      }
    } catch (err) {
      console.error('[BILA] Gagal memproses data dari ESP8266:', err);
    }
  }

  function connectWebSocket(url) {
    if (!url) return;
    var finalUrl = normalizeEspAddress(url);
    if (!finalUrl) return;

    hardware.shouldReconnect = true;

    // Tutup koneksi lama dulu supaya tidak ada banyak WebSocket sekaligus.
    if (hardware.ws) {
      try {
        hardware.ws.onopen = null;
        hardware.ws.onmessage = null;
        hardware.ws.onclose = null;
        hardware.ws.onerror = null;
        hardware.ws.close();
      } catch (e) { /* diamkan */ }
      hardware.ws = null;
    }
    clearTimeout(hardware.reconnectTimer);

    console.log('[BILA] Mencoba koneksi ke:', finalUrl);
    updateDeviceBadge(false, 'Menghubungkan...');

    try {
      hardware.ws = new WebSocket(finalUrl);
    } catch (e) {
      console.error('[BILA] Gagal membuat WebSocket:', e);
      updateDeviceBadge(false);
      return;
    }

    hardware.ws.onopen = function () {
      console.log('[BILA] ESP8266 TERHUBUNG');
      updateDeviceBadge(true);
    };
    hardware.ws.onmessage = function (evt) {
      console.log('[BILA] Data dari ESP8266:', evt.data);
      parseHardwareMessage(evt.data);
    };
    hardware.ws.onclose = function (evt) {
      var codeInfo = (evt && evt.code !== undefined) ? ' (close code: ' + evt.code + ')' : '';
      console.warn('[BILA] WebSocket TERPUTUS' + codeInfo);
      updateDeviceBadge(false);
      if (hardware.shouldReconnect && !hardware.simulasi) {
        clearTimeout(hardware.reconnectTimer);
        hardware.reconnectTimer = setTimeout(function () { connectWebSocket(finalUrl); }, 3000);
      }
    };
    hardware.ws.onerror = function (evt) {
      console.error('[BILA] WebSocket ERROR', evt);
      updateDeviceBadge(false);
    };
  }

  function disconnectWebSocket() {
    hardware.shouldReconnect = false;
    clearTimeout(hardware.reconnectTimer);
    if (hardware.ws) {
      console.log('[BILA] Memutus koneksi ESP8266 secara manual');
      try {
        hardware.ws.onclose = null;
        hardware.ws.close();
      } catch (e) { /* diamkan */ }
      hardware.ws = null;
    }
    updateDeviceBadge(false);
  }

  // statusText opsional: dipakai untuk menampilkan "Menghubungkan..." dsb.
  // Kalau tidak diisi, fallback ke "Alat terhubung" / "Alat tidak terhubung".
  function updateDeviceBadge(isConnected, statusText) {
    hardware.connected = isConnected;
    var badges = document.querySelectorAll('.device-badge');
    badges.forEach(function (b) {
      b.classList.toggle('connected', isConnected && !hardware.simulasi);
      b.classList.toggle('simulasi', hardware.simulasi);
    });
    var text = document.getElementById('deviceBadgeText');
    if (text) {
      if (hardware.simulasi) {
        text.textContent = 'Mode simulasi aktif';
      } else if (statusText) {
        text.textContent = statusText;
      } else {
        text.textContent = isConnected ? 'Alat terhubung' : 'Alat tidak terhubung';
      }
    }
  }

  /* ========================================================================
     DATA LEVEL & SOAL
     ======================================================================== */
  var QUESTIONS_PER_LEVEL = 5;

  var LEVELS = [
    { id: 1, label: 'Kelas 1', title: 'Mengenal Angka', maxTarget: 5, type: 'susun' },
    { id: 2, label: 'Kelas 2', title: 'Pengurangan Dasar', maxTarget: 6, type: 'kurang' },
    { id: 3, label: 'Kelas 3', title: 'Penjumlahan Dasar', maxTarget: 7, type: 'susun' },
    { id: 4, label: 'Kelas 4', title: 'Berhitung Lanjutan', maxTarget: 8, type: 'kurang' },
    { id: 5, label: 'Kelas 5', title: 'Berhitung Sampai 10', maxTarget: 9, type: 'susun' },
    { id: 6, label: 'Kelas 6', title: 'Tantangan Akhir', maxTarget: 10, type: 'kurang' }
  ];

  function generateQuestions(level) {
    var qs = [];
    for (var i = 0; i < QUESTIONS_PER_LEVEL; i++) {
      var target = 2 + ((i + level.id) % (level.maxTarget - 1));
      qs.push({
        target: target,
        type: level.type,
        instruksi: level.type === 'susun'
          ? 'Targetnya adalah ' + target + '! Susun balokmu sampai jadi ' + target
          : 'Targetnya adalah ' + target + '! Kurangi balokmu jadi ' + target
      });
    }
    return qs;
  }

  /* ========================================================================
     STATE
     ======================================================================== */
  var STORAGE_KEY = 'bila_state_v1';

  var state = {
    siswa: null,
    progress: {},
    currentLevelId: null,
    currentQuestions: [],
    currentQIndex: 0,
    correctCount: 0,
    placedBlocks: {}   // { uid: value } — balok fisik yang sedang di reader
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.progress) state.progress = saved.progress;
        if (saved && saved.siswa) state.siswa = saved.siswa;
      }
    } catch (e) { /* lanjut tanpa persist */ }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ siswa: state.siswa, progress: state.progress }));
    } catch (e) { /* diamkan */ }
  }
  function isLevelUnlocked(levelId) {
    if (levelId === 1) return true;
    var prev = state.progress[levelId - 1];
    return !!(prev && prev.completed);
  }
  function getPlacedSum() {
    var sum = 0;
    for (var uid in state.placedBlocks) { sum += state.placedBlocks[uid]; }
    return sum;
  }

  /* ========================================================================
     NAVIGASI
     ======================================================================== */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('is-active', s.getAttribute('data-screen') === name);
    });
    window.scrollTo(0, 0);
  }

  /* ========================================================================
     1. SPLASH
     ======================================================================== */
  function initSplash() {
    var screen = document.getElementById('screen-splash');
    var dots = screen.querySelectorAll('.splash-dots span');
    var dotIndex = 0;
    var dotTimer = setInterval(function () {
      dotIndex = (dotIndex + 1) % dots.length;
      dots.forEach(function (d, i) { d.classList.toggle('active', i === dotIndex); });
    }, 700);
    function goNext() {
      clearInterval(dotTimer);
      screen.removeEventListener('click', goNext);
      showScreen('input');
    }
    screen.addEventListener('click', goNext);
    setTimeout(function () { if (screen.classList.contains('is-active')) goNext(); }, 4500);
  }

  /* ========================================================================
     2. INPUT SISWA
     ======================================================================== */
  function initInputSiswa() {
    var namaInput = document.getElementById('inputNama');
    var nisnInput = document.getElementById('inputNisn');
    var btnMulai = document.getElementById('btnMulai');

    if (state.siswa) {
      namaInput.value = state.siswa.nama || '';
      nisnInput.value = state.siswa.nisn || '';
    }
    function setError(has) { namaInput.closest('.field').classList.toggle('has-error', has); }
    namaInput.addEventListener('input', function () { setError(false); });

    btnMulai.addEventListener('click', function () {
      soundClick();
      var nama = namaInput.value.trim();
      if (!nama) { setError(true); namaInput.focus(); return; }
      state.siswa = { nama: nama, nisn: nisnInput.value.trim() };
      saveState();
      document.getElementById('siswaNamaDisplay').textContent = nama.split(' ')[0];
      renderLevelSelection();
      showScreen('level');
    });

    // Dipanggil otomatis saat kartu RFID siswa terbaca (lewat hardware.onmessage
    // type 'student', atau bisa dipanggil manual untuk testing di console:
    //   window.BILA_onRfidScan('04A3F19B2C', { nama: 'Rizki', nisn: '0051234567' });
    window.BILA_onRfidScan = function (uid, siswaData) {
      var dot = document.getElementById('rfidStatusDot');
      var text = document.getElementById('rfidStatusText');
      if (dot) dot.classList.add('ready');
      if (text) text.textContent = 'Kartu terbaca: ' + uid;
      if (siswaData && siswaData.nama) {
        namaInput.value = siswaData.nama;
        nisnInput.value = siswaData.nisn || '';
      }
    };
  }

  /* ========================================================================
     3. LEVEL SELECTION
     ======================================================================== */
  function renderLevelSelection() {
    var path = document.getElementById('levelPath');
    path.innerHTML = '';
    LEVELS.forEach(function (level) {
      var prog = state.progress[level.id];
      var unlocked = isLevelUnlocked(level.id);
      var completed = !!(prog && prog.completed);
      var node = document.createElement('div');
      node.className = 'level-node ' + (completed ? 'completed' : (unlocked ? 'unlocked' : 'locked'));
      var circleInner = (completed || unlocked)
        ? level.id
        : '<svg class="level-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
      node.innerHTML =
        '<button class="level-circle" ' + (unlocked ? '' : 'disabled aria-disabled="true"') + ' aria-label="' + level.label + (unlocked ? '' : ' (terkunci)') + '">' +
          circleInner +
          (completed ? '<span class="level-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M20 6 9 17l-5-5"/></svg></span>' : '') +
        '</button>' +
        '<span class="level-label">' + level.label + '<span class="level-sub">' + level.title + '</span></span>';
      var btn = node.querySelector('.level-circle');
      if (unlocked) btn.addEventListener('click', function () { soundClick(); startLevel(level.id); });
      path.appendChild(node);
    });
  }

  /* ========================================================================
     4. SOAL / GAME — didorong oleh data balok fisik dari hardware
     ======================================================================== */
  function startLevel(levelId) {
    var level = LEVELS.filter(function (l) { return l.id === levelId; })[0];
    if (!level) return;
    state.currentLevelId = levelId;
    state.currentQuestions = generateQuestions(level);
    state.currentQIndex = 0;
    state.correctCount = 0;
    showScreen('soal');
    renderQuestion();
  }

  function renderQuestion() {
    var q = state.currentQuestions[state.currentQIndex];
    if (!q) return;

    document.getElementById('soalInstruksi').textContent = q.instruksi;
    setMascot(document.getElementById('soalMascot'), 'pointing');

    var targetDots = document.getElementById('targetDots');
    targetDots.innerHTML = '';
    for (var t = 0; t < q.target; t++) {
      var d = document.createElement('span');
      d.className = 'dot';
      targetDots.appendChild(d);
    }

    // reset balok yang terbaca dari sensor setiap ganti soal
    state.placedBlocks = {};
    renderBlockTray();

    document.getElementById('soalStepText').textContent =
      'Soal ke-' + (state.currentQIndex + 1) + ' dari ' + state.currentQuestions.length;

    var dotsWrap = document.getElementById('soalProgressDots');
    dotsWrap.innerHTML = '';
    state.currentQuestions.forEach(function (_, i) {
      var pd = document.createElement('span');
      pd.className = 'pdot' + (i < state.currentQIndex ? ' done' : (i === state.currentQIndex ? ' current' : ''));
      dotsWrap.appendChild(pd);
    });

    document.getElementById('btnCekJawaban').disabled = false;
  }

  function renderBlockTray() {
    var row = document.getElementById('hitungRow');
    var uids = Object.keys(state.placedBlocks);
    row.classList.toggle('has-blocks', uids.length > 0);
    row.innerHTML = '';

    if (uids.length === 0) {
      row.innerHTML =
        '<div class="tray-empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>' +
          'Taruh balok di alat pembaca untuk mulai menghitung' +
        '</div>';
    } else {
      uids.forEach(function (uid) {
        var tile = document.createElement('button');
        tile.className = 'block-tile';
        tile.textContent = state.placedBlocks[uid];
        tile.title = 'Angkat balok ini (uid: ' + uid + ')';
        tile.addEventListener('click', function () { handleBlockRemove(uid); });
        row.appendChild(tile);
      });
    }
    document.getElementById('balokCount').textContent = getPlacedSum();
  }

  function handleBlockPlace(uid, value) {
    state.placedBlocks[uid] = value;
    renderBlockTray();
    soundRfid();
  }
  function handleBlockRemove(uid) {
    delete state.placedBlocks[uid];
    renderBlockTray();
  }

  function initSoalActions() {
    document.getElementById('btnSpeaker').addEventListener('click', function () {
      var q = state.currentQuestions[state.currentQIndex];
      if (!q) return;
      if ('speechSynthesis' in window) {
        var utter = new SpeechSynthesisUtterance(q.instruksi);
        utter.lang = 'id-ID';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    });

    document.getElementById('btnCekJawaban').addEventListener('click', function () {
      soundClick();
      var q = state.currentQuestions[state.currentQIndex];
      if (!q) return;
      var isCorrect = getPlacedSum() === q.target;
      document.getElementById('btnCekJawaban').disabled = true;
      showFeedback(isCorrect);
    });
  }

  /* ========================================================================
     5 & 6. OVERLAY FEEDBACK
     ======================================================================== */
  function showFeedback(isCorrect) {
    var overlay = document.getElementById('overlayFeedback');
    var card = document.getElementById('overlayCard');
    var title = document.getElementById('overlayTitle');
    var sub = document.getElementById('overlaySub');
    var mascotImg = document.getElementById('overlayMascot');
    var nextBtn = document.getElementById('btnOverlayNext');

    card.className = 'overlay-card ' + (isCorrect ? 'overlay-benar' : 'overlay-salah');
    mascotImg.className = 'mascot mascot-lg ' + (isCorrect ? 'mascot-pop' : 'mascot-shake');
    setMascot(mascotImg, isCorrect ? 'happy' : 'sad');

    if (isCorrect) {
      soundCorrect();
    } else {
      soundWrong();
    }

    if (isCorrect) {
      title.textContent = 'Benar sekali!';
      var isLastQuestion = state.currentQIndex === state.currentQuestions.length - 1;
      sub.textContent = isLastQuestion ? 'Level selesai, kerja bagus!' : 'Lanjut ke soal berikutnya…';
      nextBtn.textContent = isLastQuestion ? 'Lihat Hasil' : 'Lanjut';
      state.correctCount++;
      spawnConfetti();
    } else {
      title.textContent = 'Ayo coba lagi, masih kurang tepat!';
      sub.textContent = 'Tidak apa-apa, atur lagi balokmu ya.';
      nextBtn.textContent = 'Coba Lagi';
    }

    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    nextBtn.onclick = function () {
      soundClick();
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      clearConfetti();
      if (isCorrect) {
        var isLast = state.currentQIndex === state.currentQuestions.length - 1;
        if (isLast) finishLevel();
        else { state.currentQIndex++; renderQuestion(); }
      } else {
        // progres soal-soal sebelumnya yang sudah benar tidak dihapus;
        // siswa cukup atur ulang balok fisiknya lalu cek lagi.
        document.getElementById('btnCekJawaban').disabled = false;
      }
    };
  }

  function spawnConfetti() {
    var holder = document.getElementById('confettiHolder');
    var colors = ['#5FE3C0', '#FFD34E', '#8C82E8', '#2E8FEA'];
    for (var i = 0; i < 18; i++) {
      var s = document.createElement('span');
      s.style.left = (Math.random() * 100) + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.3) + 's';
      s.style.borderRadius = Math.random() > .5 ? '50%' : '2px';
      holder.appendChild(s);
    }
  }
  function clearConfetti() { document.getElementById('confettiHolder').innerHTML = ''; }

  /* ========================================================================
     7 & 8. LEVEL SELESAI / LEVEL BERIKUTNYA TERBUKA
     ======================================================================== */
  function finishLevel() {
    var levelId = state.currentLevelId;
    var level = LEVELS.filter(function (l) { return l.id === levelId; })[0];
    var totalQ = state.currentQuestions.length;
    var stars = state.correctCount >= totalQ ? 3 : (state.correctCount >= Math.ceil(totalQ * 0.6) ? 2 : 1);

    state.progress[levelId] = { completed: true, stars: stars };
    saveState();
    soundLevelComplete();

    setMascot(document.getElementById('selesaiMascot'), 'happy');
    document.getElementById('selesaiTitle').textContent = level.label + ' selesai!';

    var starEls = document.querySelectorAll('#starsRow svg');
    starEls.forEach(function (el, i) { el.classList.toggle('earned', i < stars); });

    var nextLevel = LEVELS.filter(function (l) { return l.id === levelId + 1; })[0];
    var unlockPanel = document.getElementById('unlockPanel');
    var unlockRow = document.getElementById('unlockRow');
    unlockRow.innerHTML = '';

    if (nextLevel) {
      unlockPanel.classList.remove('hidden');
      unlockRow.innerHTML =
        '<div class="unlock-node done"><div class="unlock-circle">' + levelId + '</div><span>' + level.label + '</span></div>' +
        '<span class="unlock-arrow">→</span>' +
        '<div class="unlock-node new"><div class="unlock-circle">' + nextLevel.id + '</div><span>' + nextLevel.label + ' terbuka!</span></div>';
    } else {
      unlockPanel.classList.add('hidden');
    }
    showScreen('selesai');
  }

  function initSelesaiActions() {
    document.getElementById('btnSelesai').addEventListener('click', function () {
      soundClick();
      renderLevelSelection();
      showScreen('level');
    });
  }

  /* ========================================================================
     PENGATURAN ALAT (modal): koneksi WebSocket ESP8266 + mode simulasi
     ======================================================================== */
  function initSettingsModal() {
    var modal = document.getElementById('settingsModal');
    var addressInput = document.getElementById('espAddress');
    var btnConnect = document.getElementById('btnConnectEsp');
    var switchSim = document.getElementById('switchSimulasi');
    var switchMusik = document.getElementById('switchMusik');
    var simPanel = document.getElementById('simPanel');
    var simGrid = document.getElementById('simGrid');
    var btnSimClear = document.getElementById('btnSimClear');
    var btnClose = document.getElementById('btnSettingsClose');

    var savedAddress = '';
    try { savedAddress = localStorage.getItem(ESP_STORAGE_KEY) || ''; } catch (e) {}
    addressInput.value = savedAddress;

    // isi tombol simulasi nilai 1-10
    for (var v = 1; v <= 10; v++) {
      (function (val) {
        var b = document.createElement('button');
        b.className = 'sim-block-btn';
        b.textContent = val;
        b.type = 'button';
        b.addEventListener('click', function () {
          var uid = 'sim-' + val + '-' + Date.now();
          handleBlockPlace(uid, val);
        });
        simGrid.appendChild(b);
      })(v);
    }
    btnSimClear.addEventListener('click', function () {
      state.placedBlocks = {};
      renderBlockTray();
    });

    document.querySelectorAll('.btn-settings-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        soundClick();
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
      });
    });
    function closeModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
    }
    btnClose.addEventListener('click', function () { soundClick(); closeModal(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    btnConnect.addEventListener('click', function () {
      soundClick();
      var rawInput = addressInput.value.trim();
      if (!rawInput) {
        console.warn('[BILA] Alamat ESP8266 kosong, tidak bisa terhubung');
        return;
      }
      var normalized = normalizeEspAddress(rawInput);
      if (!normalized) {
        console.warn('[BILA] Alamat ESP8266 tidak valid:', rawInput);
        return;
      }
      try { localStorage.setItem(ESP_STORAGE_KEY, normalized); } catch (e) {}
      addressInput.value = normalized;

      hardware.simulasi = false;
      switchSim.classList.remove('on');
      switchSim.setAttribute('aria-checked', 'false');
      simPanel.classList.add('hidden');
      connectWebSocket(normalized);
    });

    switchSim.addEventListener('click', function () {
      soundClick();
      hardware.simulasi = !hardware.simulasi;
      switchSim.classList.toggle('on', hardware.simulasi);
      switchSim.setAttribute('aria-checked', String(hardware.simulasi));
      simPanel.classList.toggle('hidden', !hardware.simulasi);
      if (hardware.simulasi) {
        disconnectWebSocket();
      }
      updateDeviceBadge(hardware.connected);
    });

    if (switchMusik) {
      switchMusik.addEventListener('click', function () {
        soundClick();
        toggleBilaMusic();
      });
    }

    // auto-connect kalau sebelumnya sudah pernah diisi alamatnya
    if (savedAddress) connectWebSocket(savedAddress);
  }

  /* ========================================================================
     INIT
     ======================================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    loadState();
    initSplash();
    initInputSiswa();
    initSoalActions();
    initSelesaiActions();
    initSettingsModal();
  });

})();