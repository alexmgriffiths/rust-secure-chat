package config

import (
	"os"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/jsii-runtime-go"
)

type CoreConfig struct {
	AppName string
	Stage   string
	Env     *awscdk.Environment
}

func StageFromEnv() string {
	if v := os.Getenv("STAGE"); v != "" {
		return v
	}
	return "dev"
}

func CdkEnvFromEnv() *awscdk.Environment {
	account := os.Getenv("CDK_DEFAULT_ACCOUNT")
	region := os.Getenv("CDK_DEFAULT_REGION")

	return &awscdk.Environment{
		Account: jsii.String(account),
		Region:  jsii.String(region),
	}
}

func (c CoreConfig) StackName(suffix string) string {
	return c.AppName + "-" + c.Stage + "-" + suffix
}
