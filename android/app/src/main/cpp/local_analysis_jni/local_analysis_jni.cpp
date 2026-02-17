#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <dlfcn.h>
#include <iomanip>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include <jni.h>

#if defined(FJ_HAS_SPEEXDSP)
extern "C" {
#include <speex_resampler.h>
}
#endif

#if defined(FJ_HAS_ESSENTIA)
#include <essentia/algorithmfactory.h>
#include <essentia/essentia.h>
#endif

namespace {
std::atomic<bool> g_cancelled{false};
std::mutex g_essentia_error_mutex;
std::string g_essentia_last_error;
std::mutex g_madmom_beats_port_error_mutex;
std::string g_madmom_beats_port_last_error;

void set_essentia_error(const std::string& error) {
    std::lock_guard<std::mutex> lock(g_essentia_error_mutex);
    g_essentia_last_error = error;
}

std::string get_essentia_error() {
    std::lock_guard<std::mutex> lock(g_essentia_error_mutex);
    return g_essentia_last_error;
}

void set_madmom_beats_port_error(const std::string& error) {
    std::lock_guard<std::mutex> lock(g_madmom_beats_port_error_mutex);
    g_madmom_beats_port_last_error = error;
}

std::string get_madmom_beats_port_error() {
    std::lock_guard<std::mutex> lock(g_madmom_beats_port_error_mutex);
    return g_madmom_beats_port_last_error;
}

struct MadmomBeatsPortSymbols {
    using ProgressFn = void (*)(uint32_t, float, void*);
    using AnalyzeFn = char* (*)(const float*, size_t, uint32_t, const char*);
    using AnalyzeWithProgressFn = char* (*)(const float*, size_t, uint32_t, const char*, ProgressFn, void*);
    using DefaultConfigFn = char* (*)();
    using ValidateConfigFn = char* (*)(const char*);
    using LastErrorFn = char* (*)();
    using LastErrorJsonFn = char* (*)();
    using FreeStringFn = void (*)(char*);

    void* handle = nullptr;
    AnalyzeFn analyze = nullptr;
    AnalyzeWithProgressFn analyze_with_progress = nullptr;
    DefaultConfigFn default_config = nullptr;
    ValidateConfigFn validate_config = nullptr;
    LastErrorFn last_error = nullptr;
    LastErrorJsonFn last_error_json = nullptr;
    FreeStringFn free_string = nullptr;
    bool load_attempted = false;
};

std::mutex g_madmom_beats_port_symbols_mutex;

MadmomBeatsPortSymbols& madmom_beats_port_symbols() {
    static MadmomBeatsPortSymbols symbols;
    return symbols;
}

bool ensure_madmom_beats_port_loaded() {
    std::lock_guard<std::mutex> lock(g_madmom_beats_port_symbols_mutex);
    MadmomBeatsPortSymbols& symbols = madmom_beats_port_symbols();
    if (symbols.analyze != nullptr && symbols.last_error != nullptr && symbols.free_string != nullptr) {
        return true;
    }
    if (symbols.load_attempted) {
        return false;
    }
    symbols.load_attempted = true;

    symbols.handle = dlopen("libmadmom_beats_port_ffi.so", RTLD_NOW | RTLD_LOCAL);
    if (symbols.handle == nullptr) {
        const char* dl_err = dlerror();
        set_madmom_beats_port_error(
            std::string("Failed to load libmadmom_beats_port_ffi.so: ") +
            (dl_err == nullptr ? "unknown dlopen error" : dl_err)
        );
        return false;
    }

    dlerror();
    symbols.analyze = reinterpret_cast<MadmomBeatsPortSymbols::AnalyzeFn>(dlsym(symbols.handle, "madmom_beats_port_analyze_json"));
    const char* analyze_err_cstr = dlerror();
    const std::string analyze_err = analyze_err_cstr == nullptr ? "" : analyze_err_cstr;
    symbols.analyze_with_progress = reinterpret_cast<MadmomBeatsPortSymbols::AnalyzeWithProgressFn>(
        dlsym(symbols.handle, "madmom_beats_port_analyze_json_with_progress")
    );
    dlerror();
    symbols.last_error = reinterpret_cast<MadmomBeatsPortSymbols::LastErrorFn>(dlsym(symbols.handle, "madmom_beats_port_last_error_message"));
    const char* last_error_err_cstr = dlerror();
    const std::string last_error_err = last_error_err_cstr == nullptr ? "" : last_error_err_cstr;
    symbols.free_string = reinterpret_cast<MadmomBeatsPortSymbols::FreeStringFn>(dlsym(symbols.handle, "madmom_beats_port_free_string"));
    const char* free_string_err_cstr = dlerror();
    const std::string free_string_err = free_string_err_cstr == nullptr ? "" : free_string_err_cstr;
    symbols.default_config = reinterpret_cast<MadmomBeatsPortSymbols::DefaultConfigFn>(dlsym(symbols.handle, "madmom_beats_port_default_config_json"));
    dlerror();
    symbols.validate_config = reinterpret_cast<MadmomBeatsPortSymbols::ValidateConfigFn>(dlsym(symbols.handle, "madmom_beats_port_validate_config_json"));
    dlerror();
    symbols.last_error_json = reinterpret_cast<MadmomBeatsPortSymbols::LastErrorJsonFn>(dlsym(symbols.handle, "madmom_beats_port_last_error_json"));
    dlerror();

    if (
        !analyze_err.empty() ||
        !last_error_err.empty() ||
        !free_string_err.empty() ||
        symbols.analyze == nullptr ||
        symbols.last_error == nullptr ||
        symbols.free_string == nullptr
    ) {
        std::ostringstream err;
        err << "Failed to resolve madmom_beats_port_ffi exports:";
        if (!analyze_err.empty()) {
            err << " madmom_beats_port_analyze_json=" << analyze_err;
        }
        if (!last_error_err.empty()) {
            err << " madmom_beats_port_last_error_message=" << last_error_err;
        }
        if (!free_string_err.empty()) {
            err << " madmom_beats_port_free_string=" << free_string_err;
        }
        set_madmom_beats_port_error(err.str());
        if (symbols.handle != nullptr) {
            dlclose(symbols.handle);
            symbols.handle = nullptr;
        }
        symbols.analyze = nullptr;
        symbols.analyze_with_progress = nullptr;
        symbols.last_error = nullptr;
        symbols.free_string = nullptr;
        return false;
    }

    set_madmom_beats_port_error("");
    return true;
}

std::string take_madmom_beats_port_string(char* value, const MadmomBeatsPortSymbols& symbols) {
    if (value == nullptr) {
        return "";
    }
    std::string result(value);
    if (symbols.free_string != nullptr) {
        symbols.free_string(value);
    }
    return result;
}

struct JniMadmomProgressContext {
    JNIEnv* env = nullptr;
    jobject callback = nullptr;
    jmethodID method = nullptr;
};

void madmom_progress_bridge(uint32_t stage, float progress, void* user_data) {
    auto* context = reinterpret_cast<JniMadmomProgressContext*>(user_data);
    if (context == nullptr || context->env == nullptr || context->callback == nullptr || context->method == nullptr) {
        return;
    }
    context->env->CallVoidMethod(
        context->callback,
        context->method,
        static_cast<jint>(stage),
        static_cast<jfloat>(progress)
    );
    if (context->env->ExceptionCheck()) {
        context->env->ExceptionClear();
    }
}

using EssentiaProgressFn = void (*)(float, void*);

struct JniEssentiaProgressContext {
    JNIEnv* env = nullptr;
    jobject callback = nullptr;
    jmethodID method = nullptr;
};

void essentia_progress_bridge(float progress, void* user_data) {
    auto* context = reinterpret_cast<JniEssentiaProgressContext*>(user_data);
    if (context == nullptr || context->env == nullptr || context->callback == nullptr || context->method == nullptr) {
        return;
    }
    context->env->CallVoidMethod(
        context->callback,
        context->method,
        static_cast<jfloat>(progress)
    );
    if (context->env->ExceptionCheck()) {
        context->env->ExceptionClear();
    }
}

void append_vector_json(std::ostringstream& out, const std::vector<double>& values) {
    out << '[';
    for (size_t i = 0; i < values.size(); ++i) {
        if (i > 0) {
            out << ',';
        }
        out << values[i];
    }
    out << ']';
}

void append_matrix_json(
    std::ostringstream& out,
    const std::vector<std::vector<double>>& matrix
) {
    out << '[';
    for (size_t row = 0; row < matrix.size(); ++row) {
        if (row > 0) {
            out << ',';
        }
        append_vector_json(out, matrix[row]);
    }
    out << ']';
}

#if defined(FJ_HAS_SPEEXDSP)
bool resample_with_speex(
    const std::vector<float>& input,
    uint32_t from_rate,
    uint32_t to_rate,
    std::vector<float>* output,
    std::string* error_out
) {
    int err = RESAMPLER_ERR_SUCCESS;
    SpeexResamplerState* state = speex_resampler_init(
        1,
        from_rate,
        to_rate,
        SPEEX_RESAMPLER_QUALITY_MAX,
        &err
    );
    if (state == nullptr || err != RESAMPLER_ERR_SUCCESS) {
        if (error_out != nullptr) {
            *error_out = err == RESAMPLER_ERR_SUCCESS ? "Failed to create SpeexDSP resampler state"
                                                      : speex_resampler_strerror(err);
        }
        if (state != nullptr) {
            speex_resampler_destroy(state);
        }
        return false;
    }

    output->clear();
    const double ratio = static_cast<double>(to_rate) / static_cast<double>(from_rate);
    const size_t estimated_output =
        std::max<size_t>(1, static_cast<size_t>(std::ceil(static_cast<double>(input.size()) * ratio)) + 256U);
    output->reserve(estimated_output);

    size_t in_offset = 0;
    constexpr uint32_t kInputChunkSize = 65'536U;
    constexpr uint32_t kMinOutputChunk = 512U;
    const float dummy_input = 0.0f;

    while (in_offset < input.size()) {
        if (g_cancelled.load()) {
            g_cancelled.store(false);
            speex_resampler_destroy(state);
            return false;
        }

        const uint32_t requested_in =
            std::min<uint32_t>(kInputChunkSize, static_cast<uint32_t>(input.size() - in_offset));
        uint32_t in_len = requested_in;
        uint32_t out_len = std::max<uint32_t>(
            kMinOutputChunk,
            static_cast<uint32_t>(std::ceil(static_cast<double>(requested_in) * ratio)) + 128U
        );
        const size_t write_offset = output->size();
        output->resize(write_offset + out_len);
        int rc = speex_resampler_process_float(
            state,
            0,
            input.data() + in_offset,
            &in_len,
            output->data() + write_offset,
            &out_len
        );
        if (rc != RESAMPLER_ERR_SUCCESS) {
            if (error_out != nullptr) {
                *error_out = speex_resampler_strerror(rc);
            }
            speex_resampler_destroy(state);
            return false;
        }
        output->resize(write_offset + out_len);
        in_offset += in_len;
        if (in_len == 0U && out_len == 0U) {
            break;
        }
    }

    // Flush buffered filter tail.
    for (int flush_iter = 0; flush_iter < 32; ++flush_iter) {
        if (g_cancelled.load()) {
            g_cancelled.store(false);
            speex_resampler_destroy(state);
            return false;
        }

        uint32_t in_len = 0U;
        uint32_t out_len = kMinOutputChunk;
        const size_t write_offset = output->size();
        output->resize(write_offset + out_len);
        int rc = speex_resampler_process_float(
            state,
            0,
            &dummy_input,
            &in_len,
            output->data() + write_offset,
            &out_len
        );
        if (rc != RESAMPLER_ERR_SUCCESS) {
            if (error_out != nullptr) {
                *error_out = speex_resampler_strerror(rc);
            }
            speex_resampler_destroy(state);
            return false;
        }
        output->resize(write_offset + out_len);
        if (out_len == 0U) {
            break;
        }
    }

    speex_resampler_destroy(state);
    return true;
}
#endif

#if defined(FJ_HAS_ESSENTIA)
bool extract_essentia_features(
    const std::vector<float>& samples,
    int sample_rate,
    int frame_size,
    int hop_size,
    const std::string& profile,
    EssentiaProgressFn progress_fn,
    void* progress_user_data,
    std::string* json_out,
    std::string* error_out
) {
    if (sample_rate <= 0 || frame_size <= 0 || hop_size <= 0) {
        *error_out = "Invalid Essentia extraction parameters";
        return false;
    }

    try {
        static std::once_flag essentia_init_once;
        std::call_once(essentia_init_once, []() {
            essentia::init();
        });

        using essentia::Real;
        using essentia::standard::Algorithm;
        using essentia::standard::AlgorithmFactory;

        AlgorithmFactory& factory = AlgorithmFactory::instance();
        const bool backend_defaults = profile == "backend_defaults";

        std::unique_ptr<Algorithm> windowing;
        std::unique_ptr<Algorithm> spectrum_alg;
        std::unique_ptr<Algorithm> mfcc_alg;
        std::unique_ptr<Algorithm> spectral_peaks_alg;
        std::unique_ptr<Algorithm> hpcp_alg;
        std::unique_ptr<Algorithm> rms_alg;

        if (backend_defaults) {
            windowing.reset(factory.create(
                "Windowing",
                "type", "hann"
            ));
            spectrum_alg.reset(factory.create(
                "Spectrum",
                "size", frame_size
            ));
            mfcc_alg.reset(factory.create(
                "MFCC",
                "highFrequencyBound", 11025.0,
                "numberCoefficients", 13,
                "inputSize", frame_size / 2 + 1
            ));
            spectral_peaks_alg.reset(factory.create(
                "SpectralPeaks",
                "orderBy", "magnitude",
                "magnitudeThreshold", 1e-6
            ));
            hpcp_alg.reset(factory.create(
                "HPCP",
                "size", 12,
                "sampleRate", static_cast<Real>(sample_rate)
            ));
            rms_alg.reset(factory.create("RMS"));
        } else {
            const Real max_frequency = std::min(5000.0f, static_cast<Real>(sample_rate) / 2.0f);

            windowing.reset(factory.create(
                "Windowing",
                "normalized", true,
                "size", frame_size,
                "type", "hann",
                "zeroPadding", 0,
                "zeroPhase", true
            ));
            spectrum_alg.reset(factory.create(
                "Spectrum",
                "size", frame_size
            ));
            mfcc_alg.reset(factory.create(
                "MFCC",
                "dctType", 2,
                "highFrequencyBound", 11025.0,
                "inputSize", frame_size / 2 + 1,
                "lowFrequencyBound", 0.0,
                "logType", "dbamp",
                "liftering", 0,
                "normalize", "unit_sum",
                "numberBands", 40,
                "numberCoefficients", 13,
                "sampleRate", static_cast<Real>(sample_rate),
                "type", "magnitude"
            ));
            spectral_peaks_alg.reset(factory.create(
                "SpectralPeaks",
                "magnitudeThreshold", 1e-6,
                "maxFrequency", max_frequency,
                "maxPeaks", 100,
                "minFrequency", 0.0,
                "orderBy", "magnitude",
                "sampleRate", static_cast<Real>(sample_rate)
            ));
            hpcp_alg.reset(factory.create(
                "HPCP",
                "bandPreset", true,
                "bandSplitFrequency", 500.0,
                "harmonics", 0,
                "maxFrequency", max_frequency,
                "maxShifted", false,
                "minFrequency", 40.0,
                "nonLinear", false,
                "normalized", "unitMax",
                "referenceFrequency", 440.0,
                "sampleRate", static_cast<Real>(sample_rate),
                "size", 12,
                "weightType", "squaredCosine",
                "windowSize", 1.0
            ));
            rms_alg.reset(factory.create("RMS"));
        }

        const int input_size = static_cast<int>(samples.size());
        const int frame_count = std::max(
            1,
            static_cast<int>(
                std::floor(
                    std::max(input_size - frame_size, 0) /
                    static_cast<double>(hop_size)
                )
            ) + 1
        );

        std::vector<Real> frame(static_cast<size_t>(frame_size), 0.0f);
        std::vector<Real> windowed;
        std::vector<Real> spectrum;
        std::vector<Real> mel_bands;
        std::vector<Real> mfcc;
        std::vector<Real> frequencies;
        std::vector<Real> magnitudes;
        std::vector<Real> hpcp;
        Real rms = 0.0f;

        std::vector<double> frame_times;
        std::vector<std::vector<double>> mfcc_rows;
        std::vector<std::vector<double>> hpcp_rows;
        std::vector<double> rms_db;

        frame_times.reserve(static_cast<size_t>(frame_count));
        mfcc_rows.reserve(static_cast<size_t>(frame_count));
        hpcp_rows.reserve(static_cast<size_t>(frame_count));
        rms_db.reserve(static_cast<size_t>(frame_count));
        const int progress_stride = std::max(1, frame_count / 400);
        if (progress_fn != nullptr) {
            progress_fn(0.0f, progress_user_data);
        }

        for (int frame_index = 0; frame_index < frame_count; ++frame_index) {
            if (g_cancelled.load()) {
                g_cancelled.store(false);
                *error_out = "Essentia extraction cancelled";
                return false;
            }

            const int start = frame_index * hop_size;
            std::fill(frame.begin(), frame.end(), 0.0f);
            if (start < input_size) {
                const int copy_count = std::min(frame_size, input_size - start);
                for (int i = 0; i < copy_count; ++i) {
                    frame[static_cast<size_t>(i)] = samples[static_cast<size_t>(start + i)];
                }
            }

            frame_times.push_back(static_cast<double>(start) / static_cast<double>(sample_rate));

            windowing->input("frame").set(frame);
            windowing->output("frame").set(windowed);
            windowing->compute();

            spectrum_alg->input("frame").set(windowed);
            spectrum_alg->output("spectrum").set(spectrum);
            spectrum_alg->compute();

            mfcc_alg->input("spectrum").set(spectrum);
            mfcc_alg->output("bands").set(mel_bands);
            mfcc_alg->output("mfcc").set(mfcc);
            mfcc_alg->compute();

            spectral_peaks_alg->input("spectrum").set(spectrum);
            spectral_peaks_alg->output("frequencies").set(frequencies);
            spectral_peaks_alg->output("magnitudes").set(magnitudes);
            spectral_peaks_alg->compute();

            if (frequencies.empty()) {
                hpcp.assign(12, 0.0f);
            } else {
                hpcp_alg->input("frequencies").set(frequencies);
                hpcp_alg->input("magnitudes").set(magnitudes);
                hpcp_alg->output("hpcp").set(hpcp);
                hpcp_alg->compute();
            }

            rms_alg->input("array").set(frame);
            rms_alg->output("rms").set(rms);
            rms_alg->compute();

            std::vector<double> mfcc_row(13, 0.0);
            for (size_t i = 0; i < mfcc_row.size() && i < mfcc.size(); ++i) {
                mfcc_row[i] = static_cast<double>(mfcc[i]);
            }

            std::vector<double> hpcp_row(12, 0.0);
            for (size_t i = 0; i < hpcp_row.size() && i < hpcp.size(); ++i) {
                hpcp_row[i] = static_cast<double>(hpcp[i]);
            }

            const double rms_value = std::max(static_cast<double>(rms), 0.0);
            const double rms_value_db = 20.0 * std::log10(rms_value + 1e-9);

            mfcc_rows.push_back(std::move(mfcc_row));
            hpcp_rows.push_back(std::move(hpcp_row));
            rms_db.push_back(rms_value_db);

            if (
                progress_fn != nullptr &&
                (frame_index == frame_count - 1 || (frame_index % progress_stride) == 0)
            ) {
                const float progress = static_cast<float>(frame_index + 1) /
                    static_cast<float>(frame_count);
                progress_fn(progress, progress_user_data);
            }
        }

        std::ostringstream json;
        json << std::fixed << std::setprecision(8);
        json << '{';
        json << "\"frame_times\":";
        append_vector_json(json, frame_times);
        json << ',';
        json << "\"mfcc\":";
        append_matrix_json(json, mfcc_rows);
        json << ',';
        json << "\"hpcp\":";
        append_matrix_json(json, hpcp_rows);
        json << ',';
        json << "\"rms_db\":";
        append_vector_json(json, rms_db);
        json << '}';

        *json_out = json.str();
        return true;
    } catch (const essentia::EssentiaException& e) {
        *error_out = e.what();
        return false;
    } catch (const std::exception& e) {
        *error_out = e.what();
        return false;
    } catch (...) {
        *error_out = "Unknown Essentia extraction failure";
        return false;
    }
}
#endif
}  // namespace

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeResample(
    JNIEnv* env,
    jobject /* thiz */,
    jfloatArray samples,
    jint fromRate,
    jint toRate) {
    if (samples == nullptr || fromRate <= 0 || toRate <= 0) {
        return env->NewFloatArray(0);
    }

    const jsize inputSize = env->GetArrayLength(samples);
    if (inputSize <= 0) {
        return env->NewFloatArray(0);
    }

    std::vector<float> input(static_cast<size_t>(inputSize));
    env->GetFloatArrayRegion(samples, 0, inputSize, input.data());

    if (fromRate == toRate) {
        jfloatArray out = env->NewFloatArray(inputSize);
        if (out != nullptr) {
            env->SetFloatArrayRegion(out, 0, inputSize, input.data());
        }
        return out;
    }

#if defined(FJ_HAS_SPEEXDSP)
    std::vector<float> output;
    std::string error;
    const bool ok = resample_with_speex(
        input,
        static_cast<uint32_t>(fromRate),
        static_cast<uint32_t>(toRate),
        &output,
        &error
    );
    if (!ok || output.empty()) {
        return env->NewFloatArray(0);
    }

    jfloatArray out = env->NewFloatArray(static_cast<jsize>(output.size()));
    if (out != nullptr) {
        env->SetFloatArrayRegion(out, 0, static_cast<jsize>(output.size()), output.data());
    }
    return out;
#else
    const double ratio = static_cast<double>(toRate) / static_cast<double>(fromRate);
    const int outputSize = std::max(1, static_cast<int>(std::floor(inputSize * ratio)));
    std::vector<float> output(static_cast<size_t>(outputSize));

    for (int i = 0; i < outputSize; ++i) {
        if (g_cancelled.load()) {
            g_cancelled.store(false);
            return env->NewFloatArray(0);
        }
        const double srcIndex = static_cast<double>(i) / ratio;
        const int baseIndex = static_cast<int>(std::floor(srcIndex));
        const double frac = srcIndex - static_cast<double>(baseIndex);
        const float s0 = input[std::min(baseIndex, inputSize - 1)];
        const float s1 = input[std::min(baseIndex + 1, inputSize - 1)];
        output[static_cast<size_t>(i)] = static_cast<float>(s0 + (s1 - s0) * frac);
    }

    jfloatArray out = env->NewFloatArray(outputSize);
    if (out != nullptr) {
        env->SetFloatArrayRegion(out, 0, outputSize, output.data());
    }
    return out;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeCancel(
    JNIEnv* /* env */,
    jobject /* thiz */) {
    g_cancelled.store(true);
}

extern "C" JNIEXPORT void JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeResetCancel(
    JNIEnv* /* env */,
    jobject /* thiz */) {
    g_cancelled.store(false);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeMadmomBeatsPortDefaultConfigJson(
    JNIEnv* env,
    jobject /* thiz */) {
    if (!ensure_madmom_beats_port_loaded()) {
        return nullptr;
    }

    MadmomBeatsPortSymbols& symbols = madmom_beats_port_symbols();
    if (symbols.default_config == nullptr) {
        return nullptr;
    }

    const std::string config = take_madmom_beats_port_string(symbols.default_config(), symbols);
    if (config.empty()) {
        return nullptr;
    }
    return env->NewStringUTF(config.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeMadmomBeatsPortAnalyzeJson(
    JNIEnv* env,
    jobject /* thiz */,
    jfloatArray samples,
    jint sampleRate,
    jstring configJson,
    jobject progressCallback) {
    if (!ensure_madmom_beats_port_loaded()) {
        return nullptr;
    }

    if (samples == nullptr || sampleRate <= 0) {
        return nullptr;
    }

    const jsize length = env->GetArrayLength(samples);
    if (length <= 0) {
        return nullptr;
    }

    jfloat* data = env->GetFloatArrayElements(samples, nullptr);
    if (data == nullptr) {
        return nullptr;
    }

    const char* config = nullptr;
    if (configJson != nullptr) {
        config = env->GetStringUTFChars(configJson, nullptr);
        if (config == nullptr) {
            env->ReleaseFloatArrayElements(samples, data, JNI_ABORT);
            return nullptr;
        }
    }

    MadmomBeatsPortSymbols& symbols = madmom_beats_port_symbols();
    if (config != nullptr && symbols.validate_config != nullptr) {
        char* validation = symbols.validate_config(config);
        if (validation != nullptr) {
            set_madmom_beats_port_error(take_madmom_beats_port_string(validation, symbols));
            if (configJson != nullptr) {
                env->ReleaseStringUTFChars(configJson, config);
            }
            env->ReleaseFloatArrayElements(samples, data, JNI_ABORT);
            return nullptr;
        }
    }

    JniMadmomProgressContext progress_context;
    progress_context.env = env;
    if (progressCallback != nullptr) {
        progress_context.callback = progressCallback;
        jclass callback_class = env->GetObjectClass(progressCallback);
        if (callback_class != nullptr) {
            progress_context.method = env->GetMethodID(callback_class, "onProgress", "(IF)V");
            env->DeleteLocalRef(callback_class);
        }
    }

    char* out = nullptr;
    if (symbols.analyze_with_progress != nullptr && progress_context.method != nullptr) {
        out = symbols.analyze_with_progress(
            reinterpret_cast<const float*>(data),
            static_cast<size_t>(length),
            static_cast<uint32_t>(sampleRate),
            config,
            madmom_progress_bridge,
            &progress_context
        );
    } else {
        out = symbols.analyze(
            reinterpret_cast<const float*>(data),
            static_cast<size_t>(length),
            static_cast<uint32_t>(sampleRate),
            config
        );
    }

    if (configJson != nullptr && config != nullptr) {
        env->ReleaseStringUTFChars(configJson, config);
    }
    env->ReleaseFloatArrayElements(samples, data, JNI_ABORT);

    if (out == nullptr) {
        if (symbols.last_error_json != nullptr) {
            const std::string error_json = take_madmom_beats_port_string(symbols.last_error_json(), symbols);
            if (!error_json.empty()) {
                set_madmom_beats_port_error(error_json);
                return nullptr;
            }
        }
        if (symbols.last_error != nullptr) {
            const std::string error_message = take_madmom_beats_port_string(symbols.last_error(), symbols);
            if (!error_message.empty()) {
                set_madmom_beats_port_error(error_message);
            }
        }
        return nullptr;
    }

    set_madmom_beats_port_error("");
    jstring json = env->NewStringUTF(out);
    if (symbols.free_string != nullptr) {
        symbols.free_string(out);
    }
    return json;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeMadmomBeatsPortLastErrorMessage(
    JNIEnv* env,
    jobject /* thiz */) {
    if (!ensure_madmom_beats_port_loaded()) {
        const std::string load_error = get_madmom_beats_port_error();
        return load_error.empty() ? nullptr : env->NewStringUTF(load_error.c_str());
    }

    MadmomBeatsPortSymbols& symbols = madmom_beats_port_symbols();
    if (symbols.last_error_json != nullptr) {
        const std::string error_json = take_madmom_beats_port_string(symbols.last_error_json(), symbols);
        if (!error_json.empty()) {
            set_madmom_beats_port_error(error_json);
            return env->NewStringUTF(error_json.c_str());
        }
    }
    if (symbols.last_error != nullptr) {
        const std::string error_message = take_madmom_beats_port_string(symbols.last_error(), symbols);
        if (!error_message.empty()) {
            set_madmom_beats_port_error(error_message);
            return env->NewStringUTF(error_message.c_str());
        }
    }
    const std::string cached_error = get_madmom_beats_port_error();
    return cached_error.empty() ? nullptr : env->NewStringUTF(cached_error.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeEssentiaExtractFeaturesJson(
    JNIEnv* env,
    jobject /* thiz */,
    jfloatArray samples,
    jint sampleRate,
    jint frameSize,
    jint hopSize,
    jstring profile,
    jobject progressCallback) {
#if !defined(FJ_HAS_ESSENTIA)
    set_essentia_error("Essentia is not linked into local_analysis_jni");
    return nullptr;
#else
    if (samples == nullptr || sampleRate <= 0 || frameSize <= 0 || hopSize <= 0) {
        set_essentia_error("Invalid Essentia JNI input");
        return nullptr;
    }

    const jsize length = env->GetArrayLength(samples);
    if (length <= 0) {
        set_essentia_error("Essentia input samples are empty");
        return nullptr;
    }

    std::vector<float> samples_vec(static_cast<size_t>(length));
    env->GetFloatArrayRegion(samples, 0, length, samples_vec.data());

    std::string profile_value;
    const char* profile_chars = nullptr;
    if (profile != nullptr) {
        profile_chars = env->GetStringUTFChars(profile, nullptr);
        if (profile_chars != nullptr) {
            profile_value = profile_chars;
            env->ReleaseStringUTFChars(profile, profile_chars);
        }
    }

    std::string features_json;
    std::string error;
    JniEssentiaProgressContext progress_context;
    EssentiaProgressFn progress_fn = nullptr;
    progress_context.env = env;
    if (progressCallback != nullptr) {
        progress_context.callback = progressCallback;
        jclass callback_class = env->GetObjectClass(progressCallback);
        if (callback_class != nullptr) {
            progress_context.method = env->GetMethodID(callback_class, "onProgress", "(F)V");
            env->DeleteLocalRef(callback_class);
            if (progress_context.method != nullptr) {
                progress_fn = essentia_progress_bridge;
            }
        }
    }
    const bool ok = extract_essentia_features(
        samples_vec,
        static_cast<int>(sampleRate),
        static_cast<int>(frameSize),
        static_cast<int>(hopSize),
        profile_value,
        progress_fn,
        progress_fn != nullptr ? &progress_context : nullptr,
        &features_json,
        &error
    );

    if (!ok) {
        set_essentia_error(error.empty() ? "Essentia extraction failed" : error);
        return nullptr;
    }

    set_essentia_error("");
    return env->NewStringUTF(features_json.c_str());
#endif
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_foreverjukebox_app_local_NativeAnalysisBridge_nativeEssentiaLastErrorMessage(
    JNIEnv* env,
    jobject /* thiz */) {
    const std::string error = get_essentia_error();
    if (error.empty()) {
        return nullptr;
    }
    return env->NewStringUTF(error.c_str());
}
