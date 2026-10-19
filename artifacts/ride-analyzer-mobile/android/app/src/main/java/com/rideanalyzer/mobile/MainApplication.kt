package com.rideanalyzer.mobile

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import android.os.Looper
import android.util.Log

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  private fun isRecoverableNativeCrash(throwable: Throwable): Boolean {
    val stack = throwable.stackTraceToString()
    val className = throwable.javaClass.name
    return stack.contains("expo.modules.location") ||
      stack.contains("expo.modules.taskManager") ||
      stack.contains("LocationTask") ||
      stack.contains("TaskService") ||
      stack.contains("ForegroundService") ||
      stack.contains("FusedLocation") ||
      className.contains("ForegroundService") ||
      throwable is SecurityException
  }

  private fun installCrashShield() {
    val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      if (isRecoverableNativeCrash(throwable)) {
        Log.e("RideAnalyzer", "Caught recoverable native location/service exception", throwable)
        if (thread == Looper.getMainLooper().thread) {
          while (true) {
            try {
              Looper.loop()
            } catch (nextThrowable: Throwable) {
              if (isRecoverableNativeCrash(nextThrowable)) {
                Log.e("RideAnalyzer", "Caught subsequent native location/service exception", nextThrowable)
              } else {
                defaultHandler?.uncaughtException(thread, nextThrowable)
                break
              }
            }
          }
        }
        return@setDefaultUncaughtExceptionHandler
      }
      defaultHandler?.uncaughtException(thread, throwable)
    }
  }

  private fun clearStaleTaskManagerState() {
    try {
      getSharedPreferences("expo.modules.taskManager", Context.MODE_PRIVATE)
        .edit()
        .clear()
        .apply()
    } catch (e: Throwable) {
      Log.w("RideAnalyzer", "Could not clear stale TaskManager preferences", e)
    }
  }

  override fun onCreate() {
    super.onCreate()
    installCrashShield()
    clearStaleTaskManagerState()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
