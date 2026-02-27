package main

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/jsii-runtime-go"

	"iac-core/internal/config"
	"iac-core/internal/stacks"
)

func main() {
	app := awscdk.NewApp(nil)

	stage := config.StageFromEnv()
	env := config.CdkEnvFromEnv()

	core := config.CoreConfig{
		AppName: "incochat",
		Stage:   stage,
		Env:     env,
	}

	net := stacks.NewNetworkStack(app, core.StackName("network"), &stacks.NetworkStackProps{
		StackProps: awscdk.StackProps{
			Env: env,
			Tags: &map[string]*string{
				"app":   jsii.String(core.AppName),
				"stage": jsii.String(core.Stage),
			},
		},
		Core: core,
	})

	platform := stacks.NewPlatformStack(app, core.StackName("platform"), &stacks.PlatformStackProps{
		StackProps: awscdk.StackProps{
			Env: env,
			Tags: &map[string]*string{
				"app":   jsii.String(core.AppName),
				"stage": jsii.String(core.Stage),
			},
		},
		Core: core,
		Vpc:  net.Vpc,
	})

	var domainName string
	var altNames *[]*string

	if stage == "prod" {
		domainName = "api.incochat.com"
		altNames = &[]*string{
			jsii.String("api-prod.incochat.com"),
		}
	} else {
		domainName = "api-" + stage + ".incochat.com"
		altNames = nil
	}

	_ = stacks.NewEdgeStack(app, core.StackName("edge"), &stacks.EdgeStackProps{
		StackProps: awscdk.StackProps{
			Env: env,
			Tags: &map[string]*string{
				"app":   jsii.String(core.AppName),
				"stage": jsii.String(core.Stage),
			},
		},
		Core:       core,
		Vpc:        net.Vpc,
		Cluster:    platform.Cluster,
		DomainName: domainName,
		AltNames:   altNames,
	})

	_ = stacks.NewOidcStack(app, core.StackName("oidc"), &stacks.OidcStackProps{
		StackProps: awscdk.StackProps{
			Env: env,
			Tags: &map[string]*string{
				"app":   jsii.String(core.AppName),
				"stage": jsii.String(core.Stage),
			},
		},
		Core:         core,
		GitHubOrg:    "incochat",
		GitHubRepos:  []string{"*"},
		GitHubBranch: "",
		Thumbprints:  nil,
	})

	app.Synth(nil)
}
