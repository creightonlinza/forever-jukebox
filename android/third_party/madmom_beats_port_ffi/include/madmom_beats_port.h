#ifndef MADMOM_BEATS_PORT_FFI_H
#define MADMOM_BEATS_PORT_FFI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Analyze mono PCM samples and return beat arrays as JSON:
// {
//   "fps": 100,
//   "beat_times": [...],
//   "beat_numbers": [...],
//   "beat_confidences": [...]
// }
// Returns NULL on error; call madmom_beats_port_last_error_message() for details.
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_analyze_json(const float *samples,
                          size_t samples_len,
                          uint32_t sample_rate,
                          const char *config_json);

typedef void (*madmom_beats_port_progress_cb)(uint32_t stage, float progress, void *user_data);

// Analyze with optional progress callback (stage, progress 0..1).
// Returns NULL on error; call madmom_beats_port_last_error_message() for details.
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_analyze_json_with_progress(const float *samples,
                                        size_t samples_len,
                                        uint32_t sample_rate,
                                        const char *config_json,
                                        madmom_beats_port_progress_cb progress_cb,
                                        void *user_data);

// Return default config JSON (pretty-printed).
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_default_config_json(void);

// Validate config JSON.
// Returns NULL on success. On validation error, returns a JSON payload:
// {"code":<u32>,"code_name":"...","message":"...","path":"...","context":"..."}.
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_validate_config_json(const char *config_json);

// Returns the last error message as a newly allocated string.
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_last_error_message(void);

// Returns numeric error code for the last error:
// 0 OK
// 1 NULL_POINTER
// 2 UTF8_ERROR
// 3 CONFIG_PARSE_ERROR
// 4 CONFIG_VALIDATION_ERROR
// 5 INVALID_INPUT
// 6 MODEL_ERROR
// 7 IO_ERROR
// 8 NOT_IMPLEMENTED
// 9 JSON_ERROR
// 10 INTERNAL_ERROR
uint32_t madmom_beats_port_last_error_code(void);

// Returns the last error as JSON payload:
// {"code":<u32>,"code_name":"...","message":"...","path":"...","context":"..."}.
// The returned string must be freed with madmom_beats_port_free_string().
char *madmom_beats_port_last_error_json(void);

// Progress stage IDs:
// 0 features
// 1 inference
// 2 DBN decode
//
// Cancellation: not supported in v4.0.0. If cancellation is needed, call from a
// worker thread and stop waiting on the caller side.

// Free a string returned by this library.
void madmom_beats_port_free_string(char *s);

#ifdef __cplusplus
} // extern "C"
#endif

#endif // MADMOM_BEATS_PORT_FFI_H
