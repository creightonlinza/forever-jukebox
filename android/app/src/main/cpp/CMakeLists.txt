cmake_minimum_required(VERSION 3.22.1)

project(fj_oboe)

add_library(fj_oboe SHARED
    native-lib.cpp
)

add_library(local_analysis_jni SHARED
    local_analysis_jni/local_analysis_jni.cpp
)

find_package(oboe REQUIRED CONFIG)
if (NOT oboe_FOUND)
    include(FetchContent)
    FetchContent_Declare(
        oboe
        GIT_REPOSITORY https://github.com/google/oboe.git
        GIT_TAG 1.9.0
    )
    set(OBOE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(OBOE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(oboe)
    if (NOT TARGET oboe::oboe)
        add_library(oboe::oboe ALIAS oboe)
    endif()
endif()

set(FJ_16K_LINK_OPTIONS
    "-Wl,-z,common-page-size=16384"
    "-Wl,-z,max-page-size=16384"
)

target_link_options(fj_oboe PRIVATE ${FJ_16K_LINK_OPTIONS})
target_link_options(local_analysis_jni PRIVATE ${FJ_16K_LINK_OPTIONS})
if (TARGET oboe)
    target_link_options(oboe PRIVATE ${FJ_16K_LINK_OPTIONS})
endif()

target_link_libraries(fj_oboe
    oboe::oboe
    log
)

target_link_libraries(local_analysis_jni
    log
)

# Optional prebuilt links for native local-analysis dependencies.
set(FJ_THIRD_PARTY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party")
set(FJ_SPEEXDSP_DIR "${FJ_THIRD_PARTY_DIR}/speexdsp")
set(FJ_ESSENTIA_PREBUILT_A "${FJ_THIRD_PARTY_DIR}/essentia/prebuilt/active/${ANDROID_ABI}/libessentia.a")
set(FJ_ESSENTIA_PREBUILT_INCLUDE_DIR "${FJ_THIRD_PARTY_DIR}/essentia/prebuilt/active/include")
set(FJ_ESSENTIA_BUILT_A "${FJ_THIRD_PARTY_DIR}/essentia/built/${ANDROID_ABI}/libessentia.a")
set(FJ_ESSENTIA_BUILT_INCLUDE_DIR "${FJ_THIRD_PARTY_DIR}/essentia/built/include")

set(FJ_SPEEXDSP_RESAMPLE_C "${FJ_SPEEXDSP_DIR}/libspeexdsp/resample.c")
if (EXISTS "${FJ_SPEEXDSP_RESAMPLE_C}")
    add_library(fj_speexdsp_resampler STATIC "${FJ_SPEEXDSP_RESAMPLE_C}")
    target_include_directories(fj_speexdsp_resampler
        PUBLIC
            "${FJ_SPEEXDSP_DIR}/include"
            "${FJ_SPEEXDSP_DIR}/libspeexdsp"
    )
    target_compile_definitions(fj_speexdsp_resampler
        PUBLIC
            OUTSIDE_SPEEX=1
            FLOATING_POINT=1
            RANDOM_PREFIX=fj_speex
    )
    target_link_libraries(local_analysis_jni fj_speexdsp_resampler)
    target_compile_definitions(local_analysis_jni PRIVATE FJ_HAS_SPEEXDSP=1)
endif()

if (EXISTS "${FJ_ESSENTIA_PREBUILT_A}")
    add_library(essentia_static_prebuilt STATIC IMPORTED)
    set_target_properties(essentia_static_prebuilt PROPERTIES IMPORTED_LOCATION "${FJ_ESSENTIA_PREBUILT_A}")
    target_link_libraries(local_analysis_jni essentia_static_prebuilt)
    target_compile_definitions(local_analysis_jni PRIVATE FJ_HAS_ESSENTIA=1)
    if (EXISTS "${FJ_ESSENTIA_PREBUILT_INCLUDE_DIR}")
        target_include_directories(local_analysis_jni PRIVATE "${FJ_ESSENTIA_PREBUILT_INCLUDE_DIR}")
    endif()
elseif (EXISTS "${FJ_ESSENTIA_BUILT_A}")
    add_library(essentia_static_built STATIC IMPORTED)
    set_target_properties(essentia_static_built PROPERTIES IMPORTED_LOCATION "${FJ_ESSENTIA_BUILT_A}")
    target_link_libraries(local_analysis_jni essentia_static_built)
    target_compile_definitions(local_analysis_jni PRIVATE FJ_HAS_ESSENTIA=1)
    if (EXISTS "${FJ_ESSENTIA_BUILT_INCLUDE_DIR}")
        target_include_directories(local_analysis_jni PRIVATE "${FJ_ESSENTIA_BUILT_INCLUDE_DIR}")
    endif()
endif()
