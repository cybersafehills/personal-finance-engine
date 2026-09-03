# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class me.oneledger.companion.data.model.** {
    *** Companion;
}
-keepclasseswithmembers class me.oneledger.companion.data.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Room-generated code is kept by the Room consumer rules.
