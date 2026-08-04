/**
 * useVoiceRecorder — grabar con `MediaRecorder`, y fallar bien cuando no se puede.
 *
 * Las dos formas de que esto no funcione tienen que dar un mensaje que diga qué
 * pasa y qué hacer, nunca una pantalla muerta:
 *
 *  1. **El navegador no lo soporta.** Se comprueba ANTES de pintar el botón
 *     (`recorderSupport`), no al pulsarlo: un botón que no puede funcionar no
 *     debe existir. Pasa en Safari antiguo y, sobre todo, al abrir la app por
 *     `http://` desde otro dispositivo de la red — `navigator.mediaDevices` solo
 *     existe en contextos seguros, y ese caso se distingue porque es el que más
 *     va a ocurrir en esta app (se prueba desde el móvil contra el portátil).
 *  2. **El permiso se deniega.** Se traduce el `name` del error del navegador,
 *     que es lo único estable entre Chrome, Firefox y Safari; el `message` es
 *     distinto en cada uno y a veces está en inglés.
 *
 * El nivel de entrada se mide con un `AnalyserNode` y no con un temporizador
 * animado: una animación de mentira sigue moviéndose con el micro mudo, que es
 * exactamente el fallo que hay que poder ver. Si la barra no se mueve al hablar,
 * el micro no está cogiendo nada.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS } from "@/types/voice";

export type RecorderSupport = "ok" | "sin-api" | "sin-contexto-seguro";

export interface RecordedClip {
  blob: Blob;
  /** Nombre con la extensión que toca según el mime real del blob. */
  filename: string;
  durationMs: number;
}

interface RecorderState {
  recording: boolean;
  /** Milisegundos grabados. Se refresca cada 200 ms. */
  elapsedMs: number;
  /** 0..1 — nivel de entrada del micrófono ahora mismo. */
  level: number;
  error: string | null;
  /** Se ha parado sola al llegar al tope. */
  hitLimit: boolean;
}

/**
 * Formatos por orden de preferencia.
 *
 * Opus primero porque comprime la voz muchísimo mejor: cinco minutos de
 * discurso caben en menos de 3 MB, y el tope del backend son 20. `audio/mp4`
 * es el que soporta Safari, que no graba webm.
 */
const CANDIDATE_TYPES: Array<{ mime: string; ext: string }> = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/mpeg", ext: "mp3" },
];

/** El primer formato que este navegador sepa grabar. */
function pickType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported?.(candidate.mime)) return candidate;
  }
  // Sin `isTypeSupported` utilizable, se deja elegir al navegador: pasar un
  // mime que no soporta lanza, no pasar ninguno nunca lo hace.
  return { mime: "", ext: "webm" };
}

/**
 * ¿Se puede grabar en este navegador? Se responde sin pedir permisos.
 *
 * Distinguir "sin contexto seguro" de "sin API" importa: el primero tiene
 * arreglo (abrir por https o por localhost) y el segundo no.
 */
export function detectRecorderSupport(): RecorderSupport {
  if (typeof window === "undefined") return "sin-api";

  const seguro = window.isSecureContext !== false;
  const tieneMedia = Boolean(navigator.mediaDevices?.getUserMedia);
  const tieneRecorder = typeof MediaRecorder !== "undefined";

  if (!tieneMedia && !seguro) return "sin-contexto-seguro";
  if (!tieneMedia || !tieneRecorder) return "sin-api";
  return "ok";
}

/** Traduce el error del navegador a algo accionable, en español. */
function translateError(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return (
        "No has dado permiso para usar el micrófono. Ábrelo en el candado de " +
        "la barra de direcciones, permite el micrófono y vuelve a intentarlo."
      );
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No se ha encontrado ningún micrófono conectado.";
    case "NotReadableError":
    case "TrackStartError":
      return (
        "Otra aplicación está usando el micrófono. Ciérrala y vuelve a " +
        "intentarlo."
      );
    case "SecurityError":
      return (
        "El navegador solo deja grabar en páginas seguras. Abre la app por " +
        "https o desde localhost."
      );
    case "AbortError":
      return "El navegador ha cancelado el acceso al micrófono. Prueba otra vez.";
    default:
      return "No se ha podido acceder al micrófono.";
  }
}

export function useVoiceRecorder() {
  const [support] = useState<RecorderSupport>(() => detectRecorderSupport());
  const [state, setState] = useState<RecorderState>({
    recording: false,
    elapsedMs: 0,
    level: 0,
    error: null,
    hitLimit: false,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const extRef = useRef("webm");
  // La promesa que resuelve `stop()`. Vive en un ref porque quien la resuelve
  // es el evento `onstop` del MediaRecorder, que ocurre fuera del render.
  const resolveRef = useRef<((clip: RecordedClip | null) => void) | null>(null);

  /** Suelta micrófono, medidor y temporizadores. Idempotente a propósito. */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;

    // Cerrar el AudioContext antes que las pistas: al revés, Chrome deja el
    // contexto colgado apuntando a una fuente muerta.
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;

    // Sin esto el indicador de "grabando" del navegador se queda encendido
    // aunque la app ya no esté grabando, que es lo más inquietante que puede
    // hacer una web con un micrófono.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  /** Bucle del medidor de nivel: RMS de la señal, suavizado. */
  const startMeter = useCallback((stream: MediaStream) => {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      // Sin medidor se puede grabar igual: es información, no requisito.
      return;
    }
    audioCtxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    let suavizado = 0;

    const loop = () => {
      analyser.getFloatTimeDomainData(buffer);
      let suma = 0;
      for (const muestra of buffer) suma += muestra * muestra;
      const rms = Math.sqrt(suma / buffer.length);

      // La voz normal ronda un RMS de 0,05-0,2: sin escalar, la barra no se
      // movería nunca. El suavizado evita el parpadeo entre fotogramas.
      const objetivo = Math.min(1, rms * 6);
      suavizado = suavizado * 0.7 + objetivo * 0.3;

      setState((s) => (s.recording ? { ...s, level: suavizado } : s));
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stop = useCallback((): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setState((s) => ({ ...s, recording: false, level: 0 }));
      return Promise.resolve(null);
    }

    return new Promise<RecordedClip | null>((resolve) => {
      resolveRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        teardown();
        setState((s) => ({ ...s, recording: false, level: 0 }));
        resolve(null);
      }
    });
  }, [teardown]);

  const start = useCallback(async (): Promise<boolean> => {
    if (support !== "ok") return false;
    if (recorderRef.current) return false;

    setState({
      recording: false,
      elapsedMs: 0,
      level: 0,
      error: null,
      hitLimit: false,
    });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Lo que trae el navegador de serie contra el ruido de una sala: nos
        // ahorra procesar nada y mejora mucho la transcripción.
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setState((s) => ({ ...s, error: translateError(error) }));
      return false;
    }

    const tipo = pickType();
    if (!tipo) {
      stream.getTracks().forEach((t) => t.stop());
      setState((s) => ({ ...s, error: "Este navegador no sabe grabar audio." }));
      return false;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        tipo.mime ? { mimeType: tipo.mime } : undefined,
      );
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setState((s) => ({
        ...s,
        error: "Este navegador no sabe grabar en ningún formato compatible.",
      }));
      return false;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    extRef.current = tipo.ext;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      // El mime del recorder manda sobre el que pedimos: el navegador puede
      // haber elegido otro, y con el mime equivocado el backend deduciría mal
      // la extensión.
      const mime = recorder.mimeType || tipo.mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];

      teardown();
      setState((s) => ({ ...s, recording: false, level: 0, elapsedMs: durationMs }));

      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.(
        blob.size > 0
          ? { blob, filename: `ensayo.${extRef.current}`, durationMs }
          : null,
      );
    };

    // Un trozo cada segundo en vez de uno solo al final: si la pestaña se
    // queda sin memoria o el navegador corta la grabación, lo emitido hasta
    // ese momento ya está a salvo en `chunksRef`.
    recorder.start(1000);
    startMeter(stream);

    tickRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed >= MAX_RECORDING_MS) {
        setState((s) => ({ ...s, elapsedMs: MAX_RECORDING_MS, hitLimit: true }));
        void stop();
        return;
      }
      setState((s) => ({ ...s, elapsedMs: elapsed }));
    }, 200);

    setState((s) => ({ ...s, recording: true, error: null }));
    return true;
  }, [startMeter, stop, support]);

  /** Tira la grabación en curso sin devolverla. Para el botón de descartar. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    chunksRef.current = [];

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ya estaba parándose */
      }
    }

    teardown();
    setState({
      recording: false,
      elapsedMs: 0,
      level: 0,
      error: null,
      hitLimit: false,
    });
  }, [teardown]);

  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return { support, ...state, start, stop, cancel, clearError };
}
