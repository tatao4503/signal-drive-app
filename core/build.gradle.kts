plugins { kotlin("jvm") }
kotlin { jvmToolchain(17) }
tasks.register<JavaExec>("verifyCore") {
    dependsOn("testClasses")
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set("kr.signal.drive.core.CoreTestMainKt")
}
