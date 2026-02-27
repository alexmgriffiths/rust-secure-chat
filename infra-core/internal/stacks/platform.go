package stacks

import (
	"iac-core/internal/config"
	iconst "iac-core/internal/constructs"
	"iac-core/internal/outputs"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsecs"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsservicediscovery"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type PlatformStackProps struct {
	awscdk.StackProps
	Core config.CoreConfig
	Vpc  awsec2.IVpc
}

type PlatformStack struct {
	awscdk.Stack
	Cluster   awsecs.ICluster
	Namespace awsservicediscovery.IPrivateDnsNamespace
}

func NewPlatformStack(scope constructs.Construct, id string, props *PlatformStackProps) *PlatformStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)

	// Cloud Map namespace owned by core.
	// Services will register themselves into this namespace.
	namespaceName := props.Core.AppName + "-" + props.Core.Stage + ".local"

	ns := awsservicediscovery.NewPrivateDnsNamespace(stack, jsii.String("Namespace"), &awsservicediscovery.PrivateDnsNamespaceProps{
		Name: jsii.String(namespaceName),
		Vpc:  props.Vpc,
	})

	cluster := awsecs.NewCluster(stack, jsii.String("Cluster"), &awsecs.ClusterProps{
		Vpc:               props.Vpc,
		ClusterName:       jsii.String(props.Core.AppName + "-" + props.Core.Stage),
		ContainerInsights: jsii.Bool(true),
	})

	// Publish SSM outputs
	ssm := outputs.NewCoreSSM(props.Core)

	iconst.PutStringParam(stack, "SsmClusterArn", iconst.StringParamProps{
		Name:  ssm.ClusterArn(),
		Value: *cluster.ClusterArn(),
	})
	iconst.PutStringParam(stack, "SsmClusterName", iconst.StringParamProps{
		Name:  ssm.ClusterName(),
		Value: *cluster.ClusterName(),
	})

	iconst.PutStringParam(stack, "SsmSdNamespaceName", iconst.StringParamProps{
		Name:  ssm.ServiceDiscoveryNamespaceName(),
		Value: namespaceName,
	})
	iconst.PutStringParam(stack, "SsmSdNamespaceId", iconst.StringParamProps{
		Name:  ssm.ServiceDiscoveryNamespaceId(),
		Value: *ns.NamespaceId(),
	})

	return &PlatformStack{
		Stack:     stack,
		Cluster:   cluster,
		Namespace: ns,
	}
}
